# `@gitea-oidc/contracts`

Gitea OIDC 应用控制面、Node SDK、框架连接器和管理端共用的公开 wire contract。
该包只包含 TypeScript 类型、版本常量、Zod schema 和解析函数，不依赖服务端实现或数据库。

## 当前发布状态

该包目前仍是 monorepo 内部的预发布 contract，`package.json` 保持 `private: true`，供管理端、
应用域、Node SDK、连接器和 CLI 共同验证。完成统一版本与多包发布编排后才会开放外部安装；当前
不要把下面命令写入生产项目。

```bash
pnpm add @gitea-oidc/contracts zod
```

运行环境要求现代 Node.js `>=20.19.0`。包以 ESM 为事实源；该 Node 版本及更高版本也可以
通过 `require(esm)` 从 CommonJS 项目加载同一入口，不维护第二份 CJS 构建。

## Monorepo 边界与构建顺序

`@gitea-oidc/contracts` 是 wire contract 的唯一事实源，由以下 workspace 消费：

- `packages/applications`：在领域服务和仓储边界解析公开 DTO。
- `apps/admin-web`：复用 schema 版本、请求和响应类型，不复制服务端类型。
- Node SDK、框架连接器和 CLI：只依赖公开 contract，不导入服务端或数据库实现。

服务端方向固定为 `contracts -> application-templates -> applications -> server-core ->
idp-server`；业务接入方向固定为 `contracts -> node -> connector-core -> framework connector`。
管理台从 `contracts` 读取类型并把构建产物装配到 `server-core`。

```bash
pnpm build:contracts
pnpm build:applications
pnpm build:admin
```

根 `pnpm build` 已按依赖顺序编排。修改 contract 后至少运行：

```bash
pnpm --filter @gitea-oidc/contracts test
pnpm --filter @gitea-oidc/contracts test:pack
```

## 连接描述与一次性凭据

可重复读取的 `ApplicationConnectionV1` 和只能在创建或轮换时交付一次的
`ApplicationCredentialV1` 是两个独立 contract：

```typescript
import {
  parseApplicationConnectionV1,
  type ApplicationCredentialV1,
} from "@gitea-oidc/contracts";

const connection = parseApplicationConnectionV1(await response.json());

const credential: ApplicationCredentialV1 = {
  schemaVersion: 1,
  applicationId: connection.applicationId,
  oidcClientId: connection.oidcClientId,
  issuer: connection.issuer,
  clientId: connection.clientId,
  kind: "client_secret",
  clientSecret: process.env.OIDC_CLIENT_SECRET ?? "",
};
```

`ApplicationConnectionV1Schema` 及其所有嵌套对象都是 strict schema。输入中出现
`clientSecret` 或其他未知字段时，解析会失败，而不是把该字段带入可重复保存、日志或展示的
connection 对象。明文 Secret 只能放在 `ApplicationCredentialV1` 或创建响应的
`credentialDelivery` 中。

`ApplicationCredentialV1` 必须携带 `applicationId`、`oidcClientId`、`issuer` 和
`clientId` 绑定字段。CLI 和 SDK 必须将这些字段与 connection 精确比较，不能接受裸
`clientSecret`，也不能把某个应用的 credential 与另一个 connection 混用。

## 创建自定义应用

创建请求会补全安全默认值：第三方信任级别、显式 consent、PKCE S256、标准 OIDC scopes，
以及不启用 refresh token 和资源服务器能力。

```typescript
import {
  CUSTOM_APPLICATION_SCHEMA_VERSION,
  parseCreateCustomApplicationRequestV1,
} from "@gitea-oidc/contracts";

const request = parseCreateCustomApplicationRequestV1({
  schemaVersion: CUSTOM_APPLICATION_SCHEMA_VERSION,
  application: {
    name: "示例应用",
    environment: "development",
  },
  client: {
    clientType: "confidential",
    redirectUris: ["http://127.0.0.1:3000/oidc/callback"],
  },
});
```

V1 创建响应的 `credentialDelivery` 只支持 `direct`，其中包含仅展示一次的
`ApplicationCredentialV1`。在带临时公钥、幂等重试和 acknowledge 的完整交换协议落地前，
本包不声明 setup code contract。

同一个 `Idempotency-Key` 的安全重放返回
`CreateCustomApplicationReceiptV1`，其 `credentialDelivery.kind` 为
`already_delivered`。调用方必须明确提示凭据不会再次显示，不能把该响应误当成首次创建结果。

创建接口必须设置 `Cache-Control: no-store`，并禁止把完整创建响应写入日志、审计、指标或
错误信息。Redirect URI 和 Post Logout Redirect URI 均禁止 query 与 fragment。生产和预发布
回调 URI 只能使用 HTTPS；开发环境仅对 loopback 地址放宽 HTTP。

`RotateApplicationCredentialRequestV1` 使用 schema 版本和 Application 乐观版本号；
`RotateApplicationCredentialResponseV1` 只接受非 system 的 confidential Client，并继续使用
一次性、与 connection 完整绑定的 direct credential。响应丢失时应先读取当前 Application version，
再发起一次新的轮换，不能重放或重新读取上一份明文。

## 结构化接入说明

`IntegrationGuideV1` 只支持标题、段落、字段、代码块、警告和步骤列表节点，不提供
HTML/raw 节点。渲染端仍须把所有文本和代码内容当作不可信纯文本进行转义，不能使用
`innerHTML` 直接渲染。

接入说明只能由可信模板生成器根据公开 `ApplicationConnectionV1` 构建。代码块必须使用
Secret 占位符；真实 `client_secret`、setup code、Token 和 Cookie 不得进入任何说明节点。

## 模板表单描述

`ApplicationTemplateFormV1` 使用纯 JSON descriptor 驱动管理台模板表单，支持 `text`、`url`、
`select`、`textarea` 和 `checkbox`。字符串字段的 `defaultValue` 必须是字符串，checkbox 的默认值
必须是布尔值；提交后的 `templateInput` 仍由所选模板的精确版本做第二次严格校验。

## 运行时校验

每类公开 DTO 都同时提供 `parse*` 和 `safeParse*` 函数：

- `parse*`：失败时抛出 `ZodError`，适合可信边界内快速失败。
- `safeParse*`：返回带 `success` 的区分联合，适合 HTTP、配置文件和 CLI 输入。

使用版本常量生成数据，不要硬编码未来可能变化的 schema 版本。
