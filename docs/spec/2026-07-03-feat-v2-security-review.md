# feat/v2 安全审查待修清单

## 元数据

- 状态：implementing
- 创建日期：2026-07-03
- 来源：AI 辅助安全审查
- 关联模块：`src/routes/adminRoutes.ts`、`src/routes/providerApiRoutes.ts`、
  `src/provider-api/BaseProviderApiClient.ts`、`src/config.ts`、
  `src/providers/FeishuAuthProvider.ts`、`src/providers/LocalAuthProvider.ts`、
  `src/ui/loginPageRenderer.ts`
- 关联任务：审查 `feat/v2` 相较于 `origin/main` 的安全风险
- 预计处理：修复完成并验证后，将长期安全约定迁移到 `docs/dev/` 或正式文档，
  然后删除或缩减本草案

## 背景

`feat/v2` 新增了内置管理后台、Provider token 仓储、Provider API 代理和 SDK 接入。
这些能力会处理 OIDC access token、第三方 Provider token、后台管理员会话和跨系统 API
代理，因此安全边界比普通业务 UI 更敏感。

本草案记录当前 review 发现的安全问题。这里不是最终设计结论，修复前需要维护者确认优先级
和兼容性影响。

## 目标

- 阻止第三方 Provider token 被后台 API 明文下发。
- 阻止业务调用方通过伪造 `operation` 绕过 Provider API 白名单。
- 避免默认配置把普通登录用户提升为后台管理员。
- 为基于 cookie 的后台写接口补齐 CSRF 防护。
- 强化后台 session cookie 在 HTTPS 部署下的传输保护。
- 避免调试日志输出密码、OAuth code、第三方 token、Feishu 解密事件或用户原始档案。
- 避免 OAuth state 和临时认证结果被全量枚举并写入日志。
- 避免服务端默认对任意浏览器 Origin 反射 CORS 响应头。
- 避免未认证后台登录入口无限创建 OAuth state 造成内存消耗。
- 避免配置文件加载失败时静默回退到开发默认配置。
- 避免 Feishu webhook 或 URL 验证请求在缺少 token、签名过期、签名缺失或签名密钥错误时
  被接受。
- 避免 Feishu 加密回调未校验密文尾部 `app_id`，导致跨应用密文或错误应用配置被接受。
- 避免任意 OIDC 客户端拿到管理员 bearer token 后调用后台管理 API。
- 避免后台用户列表把未校验的 `sortBy`、分页和过滤参数透传到 SQL 仓储。
- 避免后台 Provider token 列表和手动探活把未校验的查询或 body 参数透传到仓储和探活服务。
- 避免 Provider API operation 未来允许业务 header 时，被调用方注入
  `Authorization`、`Cookie`、`Host`、`Forwarded` 或 `X-Forwarded-*` 等凭证和路由类 header。
- 避免 Provider token 定时探活每轮全表解密扫描，造成可被 token 数量放大的周期性资源消耗。
- 避免 Provider API 代理把下游 Provider 或网络库错误中的 token-like 文本原样返回给 SDK
  调用方。
- 避免后台 BFF session 无容量上限，在长期运行或自动化登录场景下持续占用进程内存。
- 避免生产环境本地认证使用 `auto`、`md5` 或 `sha`，导致弱哈希或明文回退进入线上。
- 避免生产环境继续接受示例默认 `oidc.cookieKeys`、短 `client_secret` 或示例默认
  `client_secret`。
- 避免 Provider API 只按 operation 名称开放，而不区分该 operation 允许 `user` token
  还是 `app` token。
- 避免 Provider API 把第三方平台响应头原样放进 SDK 响应体。
- 避免认证插件通过不安全 path 注册到自身 `/auth/{provider}` 边界之外，或造成路由混淆。
- 避免认证插件通过 `route.options.url`、`route.options.method` 或 `route.options.handler`
  覆盖服务端已校验的插件路由边界。
- 避免认证插件 middleware 使用前缀匹配时影响同前缀的其它 provider 路径。
- 避免白名单 OIDC client 的普通登录 access token 在未申请专用 scope 时调用 Provider API。
- 避免用户仓储更新 `authProvider` 或 `externalId` 后保留旧外部身份映射，或把同一外部身份绑定到
  多个不同 `sub`。
- 避免持久化用户仓储只依赖应用层查询判断外部身份唯一性，导致并发改绑或直接仓储写入绕过
  `authProvider/externalId` 唯一约束。
- 避免作为模块调用 `start(customConfig)` 时绕过配置文件路径已有的生产环境安全校验。
- 避免后台登录隐式使用 `clients[0]`，导致错误 OIDC client 承载后台授权码流程或缺少后台
  callback 时启动后才失败。
- 避免 Provider token 已被标记为 `revoked`、`refresh_failed` 或 `unknown` 后仍被继续用于
  第三方 Provider API 代理调用。
- 避免 Provider token 被本地标记为 `revoked` 后，被自动探活或后台手动探活重新标记为
  `valid`。
- 避免 Provider API 路径模板参数通过 encoded slash、encoded dot-segment 或保留分隔符造成
  下游 Provider URL 路径混淆。
- 避免 `oidc.issuer` 指向非 `${server.url}/oidc` 地址，导致 OIDC 发现文档、后台授权跳转或
  token 交换偏离当前服务。
- 避免 Provider API 自行解析 OIDC bearer token 时绕过 `oidc-provider` 对关联 client 和
  授权 grant 的有效性校验。
- 避免 `server.url`、`oidc.issuer` 或 `server.corsOrigins` 接受 query、fragment 或非 Origin
  形式，导致 OIDC issuer、后台 callback 或 CORS allowlist 语义不稳定。
- 避免自动生成的 JWKS 私钥文件受进程 umask 影响变成 group/other 可读。
- 避免生产环境 Provider API provider 使用明文或带 userinfo/query/fragment 的 `baseUrl` 作为
  第三方 token 出站端点。
- 避免 Provider API 代理、Provider app token 获取或用户 token 刷新被慢连接或无响应第三方接口
  长时间挂住。
- 避免统一登录页把未转义 interaction UID、可执行 URL 或缺少 CSP 的 provider 登录 UI 暴露给
  未认证访问者。

## 非目标

- 不在本草案中处理 SDK `exports` 类型路径、`admin.basePath` 前端硬编码、
  PostgreSQL token 表初始化竞态等非安全 review 项。
- 不重新设计完整的管理台 RBAC 模型。
- 不替代正式安全文档；本文件只作为修复前的临时追踪清单。

## 方案

### 2026-07-09 修复进度

本轮已落地以下安全改动，并已通过测试和构建验证：

- Provider API 改为服务端 `operation` 定义绑定实际 `method`、`path` 和路径模板参数。
- `/admin/api/tokens` 改为返回后台 token 摘要 DTO，不返回 `accessToken` 或 `refreshToken`。
- `providerApi.enabled` 默认关闭；启用时要求至少 32 字符且非占位的
  `providerApi.tokenEncryptionKey`。
- 后台默认管理员组改为 `gitea-oidc-admins`，飞书组映射不再自动追加后台管理员组。
- cookie session 认证的后台写接口增加同源来源、JSON 和自定义 header 校验。
- HTTPS 部署下后台 session cookie 自动追加 `Secure`。
- cookie session 命中的后台用户如果已非 `active`，会被拒绝并清理 session。
- 新增日志脱敏工具，OIDC 请求、claims、Feishu 回调、Feishu webhook 和 Provider 探活错误
  只输出脱敏值或摘要。
- 通用日志脱敏会处理 `Error.message` 和普通字符串字段中的 token-like 文本，避免第三方 SDK
  或网络库把 `Authorization`、`access_token`、`refresh_token`、`app_access_token`、
  `tenant_access_token`、`client_secret`、OAuth `code` 等敏感值塞进错误消息后绕过字段名
  脱敏。
- `AuthCoordinator` 通过 Fastify `app.log` 输出 provider 初始化、认证、state、账户查询和销毁错误时，
  会先对 Error 做脱敏摘要，避免 pino 序列化原始 `err.message` 或 stack 中的 token-like 文本。
- `@fastify/cors` 默认改为 `origin: false`；新增 `server.corsOrigins` 显式 Origin
  allowlist，浏览器 SDK 跨域访问必须配置精确来源。
- 后台用户 API 改为返回 `AdminUser` 摘要 DTO，不再向浏览器下发 `metadata`、
  `providerProfile.raw` 或 Provider 原始用户档案。
- Provider API 已增加 operation 级 `query`、`headers` 和 `body` 边界：
  调用方只能提交服务端定义允许的 query/header，默认不转发 body，且路径参数和查询参数
  必须是标量。
- Provider API 路径模板参数会被限制为安全单路径段，拒绝 encoded slash、`..`、`%`、`\`、
  `?` 和 `#` 等路径混淆输入。
- Provider API 请求进入 Provider client 前会先做运行时结构校验，非法 body、空
  `operation`、非法 `tokenKind` 或非对象 `query`/`headers`/`pathParams` 会被拒绝。
- 后台用户创建和编辑已改为字段白名单，只允许管理台可编辑字段；`metadata`、
  `providerProfile`、`emailVerified`、`lastLoginAt` 等内部或 Provider 同步字段会被拒绝。
- 后台 OAuth 登录 state 已改为一次性、短 TTL 且有容量上限，防止未认证
  `/admin/login/start` 请求无限占用内存。
- 配置文件只在非生产环境完全不存在时使用开发默认；`NODE_ENV=production` 下缺少配置文件、
  或 JS/JSON 配置文件存在但加载、解析、验证失败时，服务都会 fail-closed 阻止启动。
- 非生产环境缺少配置文件时返回的开发默认配置也会经过统一 Zod 和运行时配置校验；开发默认
  `oidc.cookieKeys` 与 `clients[].client_secret` 满足 schema 最低长度，但仍作为 dev-only
  默认值给出 warning，并在生产环境被拒绝。
- `NODE_ENV=production` 下，非 HTTPS 的 `server.url`、`oidc.issuer`、客户端回调 URL、
  `server.corsOrigins`，以及 memory 用户仓储或 memory OIDC 适配器都会被配置验证拒绝。
- Provider API SDK 代理会校验 OIDC access token 的 `client_id`；
  `NODE_ENV=production` 下启用代理时必须配置 `providerApi.allowedClientIds`，避免低信任客户端
  复用用户 access token 横向调用第三方 Provider API。
- Provider token 刷新、探活、调度器日志和三个 Provider token 仓储的 `lastError` 写入/读取路径
  都会脱敏 `access_token`、`refresh_token`、`Authorization: Bearer ...`、`client_secret`
  等 token-like 文本。
- Feishu webhook 签名校验使用飞书事件订阅 `encryptKey`，并增加时间戳新鲜度检查；
  webhook payload、callback 路由上的明文或加密 URL 验证都会校验飞书
  `verificationToken`。
- 后台 `/admin/api/*` 改为只接受后台 BFF session cookie，不再接受 OIDC bearer token。
- `AuthCoordinator.verifyOAuthState()` 不再调用 `MemoryStateStore.listAll()` 并把所有未完成
  OAuth state、临时 `auth_result`、用户 ID、IP 或 User-Agent 写入 info 日志。
- 后台用户列表查询参数改为显式白名单，SQLite/PostgreSQL 用户仓储也会校验排序字段，
  不再把任意 `sortBy` 拼进 `ORDER BY`。
- 后台用户列表未传 `limit` 时默认只读取前 100 条，避免打开用户页时一次性读取全量用户。
- 后台 Provider token 列表查询和手动探活请求改为显式白名单；三个 token 仓储也会校验
  `ownerType`、`status`、`offset` 和 `limit`，拒绝非法枚举、负数分页和未知字段。
- 后台 Provider token 列表未传 `limit` 时默认只读取前 100 条，避免打开 Token 页时一次性
  解密整张 token 表。
- Provider API 调用方提交的 header 会先经过保留 header 黑名单和基本格式校验；即使未来
  operation 允许业务 header，也不能转发 `Authorization`、`Cookie`、`Host`、
  `Forwarded`、`X-Forwarded-*` 等凭证或路由类 header。
- Provider API 保留 header 黑名单进一步覆盖 `X-Real-IP`、`CF-Connecting-IP`、
  `True-Client-IP`、方法覆盖和反向代理重写类 header，避免业务 header 扩展点被用于伪造
  下游来源、HTTP 方法或内部重写路径。
- Provider token 调度器优先使用仓储的 `listProbeCandidates()` 候选查询，每轮只处理有上限的
  候选批次；内置 memory、SQLite 和 PostgreSQL 仓储不再依赖全量 `list()` 后进程内筛选。
- Provider API 代理错误响应会使用 token 错误摘要，不再把下游异常里的
  `Authorization: Bearer ...`、`access_token`、`refresh_token` 或 `client_secret`
  原样返回给调用方。
- 后台 BFF session 创建前会清理过期 session，并在达到容量上限时淘汰最旧 session，
  避免长期运行时后台会话表无界增长。
- 本地登录只为密码文件中存在的账号记录失败次数，避免随机用户名撑大内存；失败计数通过
  `auth.stateStore` 原子递增，多实例 Redis 部署不能通过轮询节点绕过锁定。
- PostgreSQL 用户仓储和 Provider token 仓储会等待表初始化完成后再执行首个查询或写入，
  避免启动后首次用户或 token 操作撞上建表竞态。
- `start()` 在启动阶段任一步失败时会复用统一资源清理流程，停止探活调度器、销毁认证系统、
  关闭 Provider token 仓储和用户仓储、销毁 state store、清理 OIDC 适配器并关闭 Fastify。
- 服务端 JSON parser 会保留原始 HTTP body，Feishu webhook 签名优先基于 raw body 计算，
  避免字段顺序或空白差异导致验签不兼容。
- 生产环境启用本地认证时，配置验证会要求 `passwordFile` 非空且 `passwordFormat` 显式为
  `bcrypt`；开发环境使用缺失或非 bcrypt 格式时会给出 warning。
- 生产环境会拒绝示例默认 `oidc.cookieKeys`，以及过短或示例默认的
  `clients[].client_secret`。
- Provider API operation 定义新增 `allowedTokenKinds`，未声明时默认只允许 `user` token；
  Feishu `contact.user.get` 已限制为 `app` token，普通用户不能用 user token 触达租户通讯录接口。
- Provider API 响应头改为安全 allowlist，只向 SDK 调用方返回 `content-type` 和
  `content-language`。
- 认证插件名称和 route/static/webhook path 在注册阶段统一校验；非法 provider 名、`..`、
  双斜杠、查询串、片段、百分号编码或反斜杠路径都会被拒绝，且不会留下半注册 provider。
- 插件 route `options` 中的 `url`、`method`、`path` 和 `handler` 会被忽略，不能覆盖
  `AuthCoordinator` 计算出的 `/auth/{provider}` 路由边界。
- 插件 middleware 钩子改为按 URL pathname 的路径段匹配，只会作用于 `/auth/{provider}` 或其
  子路径，不会误命中 `/auth/{provider}2` 等同前缀路径。
- Feishu 加密 callback payload 改为按官方 `random + msg_len + msg + app_id` 格式解析，并拒绝
  密文尾部 `app_id` 与配置 `appId` 不匹配的请求。
- Provider API SDK 代理入口新增 `provider_api` scope gate；即使 access token 来自
  `providerApi.allowedClientIds` 白名单 client，缺少该 scope 也会被拒绝。
- 后台通用用户编辑拒绝修改 `authProvider/externalId`，避免身份持久化成功但凭据撤销失败时
  留下新身份绑定与旧令牌并存的不一致状态。仓储层仍校验外部身份唯一性，供 Provider 同步和
  未来专用改绑流程复用。
- 禁用或删除用户会先撤销 OIDC 和 Provider 凭据；撤销失败时不会先持久化账号状态变化。
- SQLite/PostgreSQL 用户仓储新增数据库级 `authProvider/externalId` 部分唯一索引，和应用层校验
  共同保证外部身份不会绑定到多个 `sub`。
- `start(customConfig)` 会执行和配置文件相同的 Zod 校验与生产环境安全校验；集成方直接传入
  custom config 时，HTTP 公网 URL、memory 仓储、弱 cookie key 或不完整 Provider API allowlist
  会在启动前被拒绝。
- 后台登录会按 `${server.url}${admin.basePath}/callback`、`code`、`authorization_code` 和
  `client_secret_basic` 选择匹配的 OIDC client；没有符合条件的 client 时配置验证会阻止启动。
- Provider API 请求发往第三方前只接受 `status: "valid"` 的 Provider token；非 valid token
  不会继续被当作可用凭证代理调用。
- `revoked` Provider token 被视为本地撤销终态；自动探活调度器、服务层探活入口和 Feishu app
  token 探活都不会把它恢复为 `valid`。
- 配置验证会要求 `oidc.issuer` 等于 `${server.url}/oidc`，避免后台登录和 OIDC 发现文档指向
  其它 Origin 或错误挂载路径。
- Provider API 解析 OIDC bearer token 时会校验 access token 仍绑定到存在的 OIDC client 和
  未过期 grant，并要求 grant 的 `clientId` 和 `accountId` 与 token 一致。
- 配置验证会拒绝带 query/fragment 的 `server.url` 或 `oidc.issuer`；`server.corsOrigins`
  必须是纯 Origin，不能带 path、query 或 fragment。
- 自动生成 JWKS 时会使用 `0600` 文件权限；加载已有 JWKS 前如果发现 group/other 访问位，
  会先收紧到 `0600`，避免签名私钥被同机其它用户读取。
- 后台 mutation 的 `Referer` fallback 改为路径段匹配，只接受 `${admin.basePath}` 或其子路径，
  不再把 `/admin2` 这类同源前缀路径当作后台来源。
- Provider API provider 的 `baseUrl` 增加运行时边界校验：启用的 provider 只能配置
  HTTP/HTTPS URL，不能包含用户名、密码、query 或 fragment；生产环境必须使用 HTTPS，避免第三方
  token 经明文或混淆 URL 出站。
- Provider API 新增 `requestTimeoutMs` 配置，默认 `10000` 毫秒并限制在 `1000..60000`；
  Provider API 代理请求、Feishu app token 获取和用户 token 刷新都会带超时信号，避免第三方
  慢连接或无响应接口长期占用服务端资源。
- 统一登录页会把 `interactionUid` 作为 URL 路径段编码，并转义 Local 登录表单 action，
  避免路径参数进入 HTML 属性或 redirect path。
- 统一登录页 OAuth 按钮只接受 HTTP(S) 或站内绝对路径 URL，拒绝 `javascript:`、协议相对地址和
  其它非预期 scheme。
- 统一登录页响应会设置 CSP、frame、nosniff 和 referrer 安全头；CSP 使用 `script-src 'none'`
  阻断 provider HTML 片段中的脚本执行。

### 1. Provider API 白名单必须绑定实际请求

当前 `src/provider-api/BaseProviderApiClient.ts` 只检查调用方提交的 `operation` 字符串，
但实际请求的 `method` 和 `path` 仍由调用方控制。攻击者可以提交一个允许的
`operation`，同时把请求代理到同一 `baseUrl` 下的其它 Provider API。

建议改为服务端维护操作定义：

- `operation` 映射到固定 `method`、`path` 和可选参数模板。
- `ProviderApiRequest` 不再允许普通调用方直接指定任意 `path` 和 `method`，
  或只允许在服务端定义的模板内填充参数。
- 现有 `allowedOperations` 只表达允许哪些操作，不表达用户可自声明操作含义。

### 2. 后台 token 列表返回摘要 DTO

当前 `src/routes/adminRoutes.ts` 的 `GET /admin/api/tokens` 直接返回
`tokenRepository.list()`。持久化仓储读取时会解密 `accessToken` 和 `refreshToken`，
导致响应体包含明文第三方 token。

建议新增后台专用 token 摘要类型，只返回：

- `id`
- `provider`
- `ownerType`
- `ownerId`
- `status`
- `expiresAt`
- `refreshExpiresAt`
- `lastProbedAt`
- `lastRefreshAt`
- `lastError`
- `createdAt`
- `updatedAt`

禁止在任何后台列表、详情、错误消息或日志中返回 `accessToken`、`refreshToken`、
`client_secret`、`appSecret`、`tokenEncryptionKey`。

### 3. 默认管理员组需要与普通 Provider 组隔离

当前 `src/config.ts` 默认使用 `admin.allowedGroups: ["Owners"]` 判断后台管理员。
同时 `src/providers/FeishuAuthProvider.ts` 的 `mapGroups()` 会在有无 `groupMapping` 时
都默认追加 `Owners`。启用飞书后，普通飞书登录用户可能自动获得后台权限。

建议采用独立后台权限标识：

- 将默认后台组改为更明确的值，例如 `GiteaOidcAdmins`。
- Feishu 默认组映射不得自动追加后台管理员组。
- 如需自动授予后台权限，应通过显式 `groupMapping` 或单独 `adminUsers` 配置完成。
- 文档中说明 `admin.allowedGroups` 是高权限入口，不能复用普通团队名。

### 4. 后台写接口需要 CSRF 防护

后台登录后使用 HttpOnly session cookie 访问 `/admin/api/*`。当前
`POST /admin/api/users`、`PATCH /admin/api/users/:sub`、`DELETE /admin/api/users/:sub`、
`POST /admin/api/tokens/probe` 等写接口只校验管理员身份，未校验 CSRF token、
`Origin`、`Referer` 或自定义请求头。

建议至少采用以下防护之一：

- 后台 HTML 注入一次性 CSRF token，所有 mutation 请求带 `X-CSRF-Token`。
- 服务端校验 `Origin` 或 `Referer` 必须匹配 `server.url`。
- mutation 接口拒绝非 JSON 请求，并要求自定义请求头。

后台 API 现在只接受后台 BFF session cookie，不再接受 OIDC bearer token。

### 5. 后台 session cookie 应在 HTTPS 下使用 `Secure`

当前后台 session cookie 设置了 `HttpOnly` 和 `SameSite=Lax`，但没有 `Secure`。
HTTPS 部署时浏览器仍可能在非 HTTPS 请求中携带该 cookie。

建议：

- 当 `server.url` 或 `oidc.issuer` 使用 `https://` 时追加 `Secure`。
- 生产模式下如果启用后台管理，应要求 `server.url` 使用 HTTPS。
- 文档中明确反向代理部署时需要正确设置 `server.url`、`oidc.issuer` 和
  `server.trustProxy`。

### 6. 日志不能记录凭证和 Provider 原始档案

当前 v2 处理的敏感材料包括本地密码、OIDC code、第三方 access token、refresh token、
Feishu webhook 解密内容、Provider 原始用户档案和用户 metadata。攻击者一旦拿到日志系统权限，
这些数据可直接用于账号接管、Provider API 横向调用或组织信息收集。

修复要求：

- OIDC query/body 调试日志必须脱敏 `code`、`password`、`client_secret`、token 和 cookie。
- `findAccount` 不记录完整 `UserInfo`、`providerProfile.raw` 或 `metadata`。
- Feishu 加密 webhook 只记录事件类型、字段列表、是否包含 challenge 等摘要。
- Error 对象进入日志前统一转成不含 stack 和请求体的摘要。
- OAuth state 校验不能为了调试枚举并打印 state store 中的完整数据。

### 7. CORS 不能默认反射任意 Origin

修复前 `src/server.ts` 全局注册 `@fastify/cors` 时使用 `origin: true`。这会让任意网页
Origin 获得 CORS 响应头。即使后台写接口已有 CSRF 防护，身份服务和 Provider API 代理仍不应
默认成为任意网页可调用的跨域 API。

修复要求：

- 默认不发送 CORS 响应头。
- 需要浏览器端 SDK 跨域访问时，通过 `server.corsOrigins` 显式列出可信 Origin。
- 配置 schema 拒绝 `*` 这类非 URL allowlist 项。

### 8. 后台用户 API 需要数据最小化

`UserInfo` 中新增的 `providerProfile.raw` 和 `metadata` 会保存飞书等 Provider 返回的原始用户档案。
这些数据可能包含手机号、部门路径、外部 union/open ID、租户信息，未来也可能扩展出更多平台字段。
后台列表、详情和当前会话接口不应直接返回完整 `UserInfo`。

修复要求：

- `/admin/api/me`、`/admin/api/users`、`/admin/api/users/:sub`、创建和更新响应都返回
  后台专用 `AdminUser` DTO。
- DTO 只包含管理台显示和编辑所需字段。
- 响应体不包含 `metadata`、`providerProfile`、`providerProfile.raw` 或原始 Provider profile。

### 9. Provider API 参数必须按 operation 最小授权

即使 `operation` 已绑定实际 `method/path`，如果调用方仍可任意提交 `query`、`headers` 或
`body`，仍可能触发第三方平台的高成本查询、调试 header 行为或未来写操作的参数污染。

修复要求：

- `query` 只允许 operation 定义中的参数名，且值必须是字符串、数字或布尔值。
- `pathParams` 必须是安全单路径段，不能包含 `/`、`\`、`%`、`?`、`#`，也不能是 `.` 或
  `..`。
- `headers` 只允许 operation 定义中的请求头名；当前内置操作默认不允许调用方附加请求头。
- `body` 默认不允许，只有 operation 显式声明后才转发。
- 未来开放写操作时，应继续补充更精确的 body schema，而不是只依赖 `allowBody`。

### 10. 后台用户写接口不能透传完整 UserInfo

后台用户 API 是高权限写入口。若把 `request.body` 直接传给用户仓储，管理员界面或被盗用的
后台接口可以写入 `metadata`、`providerProfile`、`emailVerified`、`lastLoginAt` 等非表单字段，
造成 OIDC claims 污染、原始档案注入或审计字段伪造。

修复要求：

- 创建和编辑用户时只接受 `username`、`name`、`email`、`authProvider`、`externalId`、
  `groups`、`roles`、`status`、`picture`、`phone`。
- `groups` 和 `roles` 必须是字符串数组。
- `status` 必须是 `active`、`disabled`、`locked` 或 `pending`。
- 其它字段一律返回 `400`，并且不调用用户仓储写入。

### 11. 后台登录 state 不能无界增长

`/admin/login/start` 是未认证入口。若每次请求都把 OAuth state 永久保存在内存中，
攻击者可以反复请求该入口造成进程内存持续增长。

修复要求：

- 登录 state 必须一次性消费。
- 未消费 state 必须短 TTL 过期。
- state 存储必须有容量上限，到达上限时淘汰旧 state。
- 过期或被淘汰的 state 不能完成后台登录回调。

### 12. 配置文件加载失败不能回退默认配置

如果用户已经提供 `gitea-oidc.config.js` 或 `gitea-oidc.config.json`，但文件加载、语法解析或
运行时执行失败，服务不能静默回退到开发默认配置。否则生产环境可能在配置错误后带着默认客户端
密钥、弱 cookie key、本地内存仓储或错误 URL 继续启动。

修复要求：

- 非生产环境配置文件完全不存在时，可以保留开发默认配置。
- `NODE_ENV=production` 且配置文件完全不存在时，必须抛错并阻止启动。
- 配置文件存在但加载或解析失败时，必须抛错并阻止启动。
- 配置验证失败时继续阻止启动。
- 测试覆盖生产缺配置文件、JS 配置加载失败和 JSON 解析失败。

### 13. Provider token 错误摘要不能保留 token-like 文本

Provider token 刷新和探活失败时，错误摘要会写入 `lastError` 并通过后台 token 状态接口展示。
如果第三方平台或网络库在错误文本中回显 `access_token`、`refresh_token`、
`app_access_token`、`tenant_access_token`、`Authorization: Bearer ...` 或 `client_secret`，
仅截断错误消息仍会造成持久化泄露。

修复要求：

- `summarizeTokenError()` 必须在截断前脱敏 token-like 文本。
- Provider token 调度器日志也必须使用同一摘要逻辑。
- Memory、SQLite 和 PostgreSQL token 仓储必须在 `upsert()`、`updateStatus()` 和读取历史
  `lastError` 时再次脱敏，避免未来调用方漏掉摘要函数后把原始 token-like 文本持久化并展示到
  后台。
- 回归测试覆盖 key-value、JSON 风格片段、Bearer token 和飞书常见的 provider-prefixed
  token 字段。

### 14. Feishu webhook 和 URL 验证必须 fail-closed

Feishu webhook 是外部系统主动调用的入口。若签名密钥使用错误、`verificationToken` 缺失时
仍放行，或者签名 timestamp 不校验新鲜度，攻击者可以伪造或重放事件请求。即使当前事件处理
主要是日志，后续一旦加入用户同步或禁用逻辑，会直接变成未认证写入口。

修复要求：

- `encryptKey` 未配置时，webhook 签名校验必须返回失败。
- 签名内容必须使用飞书事件订阅 `encryptKey`，不能把 `verificationToken` 当作签名密钥。
- 签名 timestamp 必须落在短时间窗口内，过期请求拒绝。
- webhook payload 中的 token 必须匹配 `verificationToken`。
- `/auth/feishu/callback` 上处理明文或加密 URL 验证时，也必须校验飞书
  `verificationToken`。
- 加密 callback payload 必须按飞书官方密文格式解析，密文尾部 `app_id` 必须匹配当前配置的
  `appId`。
- 文档说明启用 Feishu webhook 时必须同时配置 `encryptKey` 和 `verificationToken`。

### 15. 后台 API 不能接受任意 OIDC bearer token

`/admin/api/*` 是内置管理台的 BFF API。若同时接受 OIDC bearer token，管理员登录任意
OIDC 客户端后，该客户端拿到的 access token 也可以调用后台管理 API。这会把所有业务客户端
都提升为潜在后台入口，和后台 cookie session、CSRF 防护的边界不一致。

修复要求：

- `/admin/api/*` 只接受后台登录后签发的 HttpOnly session cookie。
- OIDC bearer token 继续只用于 Provider API 代理等明确的业务 API。
- 回归测试覆盖 bearer token 访问后台 API 返回 `401`。

### 16. 后台用户列表查询不能透传任意排序字段

后台用户列表是高权限接口，但它仍然会进入生产数据库查询。若 `request.query.sortBy`
未经校验传给仓储，SQLite/PostgreSQL 实现会把该字段拼接到 `ORDER BY`，形成管理员入口下的
SQL 注入或数据库语句破坏风险。

修复要求：

- `/admin/api/users` 只接受显式列出的过滤、排序和分页参数。
- `sortBy` 必须命中用户列表字段白名单，非法值返回 `400`。
- `offset` 和 `limit` 必须是整数，`limit` 需要有合理上限。
- SQLite/PostgreSQL 仓储使用字段到 SQL 列名的白名单映射，不能直接拼接调用方输入。
- 内存仓储也使用同一套运行时校验，保证不同存储后端行为一致。

### 17. 后台 Provider token 查询和探活输入必须白名单化

`GET /admin/api/tokens` 和 `POST /admin/api/tokens/probe` 都是后台高权限入口。虽然这些接口
只接受后台 session cookie，但它们会触达第三方 token 仓储和探活服务。若把原始 query/body
直接传入下游，负数或超大分页可能导致后台查询不可控，非法 `ownerType`、`status` 或未知字段
也会放大维护风险。

修复要求：

- `/admin/api/tokens` 只接受 `provider`、`ownerType`、`ownerId`、`status`、`offset`
  和 `limit`。
- `ownerType` 必须是 `user` 或 `app`；`status` 必须是已定义 token 状态。
- `offset` 和 `limit` 必须是整数，`limit` 需要有合理上限。
- 未传 `limit` 时必须使用安全默认值，避免后台页面一次性读取和解密全量 token。
- `POST /admin/api/tokens/probe` 只接受合法 `provider`、`ownerType` 和 `ownerId`。
- Memory、SQLite、PostgreSQL token 仓储也执行同样的运行时校验，避免未来绕过路由直接调用。

### 18. Provider API 允许业务 header 时仍需拒绝凭证和路由类 header

Provider API 的 `allowedHeaders` 是未来开放特定业务 header 的扩展点。如果仅按 operation
白名单判断 header 名，维护者后续误配置 `Authorization`、`Cookie`、`Host`、
`Forwarded`、`X-Forwarded-*` 等 header 时，调用方可能尝试注入第三方凭证、覆盖请求路由语义，
或触发上游代理的异常行为。

修复要求：

- 无论 operation 是否声明允许，调用方都不能提交 `Authorization`、`Proxy-Authorization`、
  `Cookie`、`Set-Cookie`、`Host`、`Content-Length`、`Transfer-Encoding`、
  `Connection`、`Upgrade`、`TE`、`Trailer`、`Proxy-Connection`、`Forwarded` 和
  `X-Forwarded-*`。
- header 名必须符合 HTTP token 形式，header 值不能包含 CR/LF。
- 服务端注入的 Provider `Authorization` 仍由 `BaseProviderApiClient` 统一生成。

### 19. Provider token 定时探活不能每轮全表解密扫描

`ProviderTokenProbeScheduler` 修复前每轮调用 `tokenRepository.list()` 读取全部 token，
持久化仓储会解密每条 `accessToken` 和 `refreshToken` 后再在进程内判断是否需要探活。
当 token 表随登录用户数增长时，攻击者或误配置流量可以把这放大成周期性数据库查询、
解密 CPU 和第三方 API 探活压力。

修复要求：

- 内置仓储提供探活候选查询，只返回异常、未探活、无过期时间或即将过期的一批 token。
- 调度器每轮设置批量上限，不能默认读取整张 token 表。
- 自定义仓储未实现候选查询时，fallback 也必须带 `limit`。
- 回归测试覆盖调度器优先调用候选查询，以及 memory、SQLite、PostgreSQL 仓储的候选查询。

### 20. Provider API 错误响应不能回显 token-like 文本

`/api/provider/:provider/request` 修复前会把 `providerApiService.request()` 抛出的
`Error.message` 原样返回给 SDK 调用方。若第三方 Provider、HTTP 客户端或未来实现的
Provider client 在错误文本中回显 `Authorization: Bearer ...`、`access_token`、
`refresh_token` 或 `client_secret`，业务调用方会在 API 响应中看到这些敏感值。

修复要求：

- Provider API 路由捕获下游错误后必须先做 token-like 文本脱敏。
- 权限错误对调用方返回通用 `Forbidden`，避免暴露内部权限判断细节。
- token/client 不存在错误返回通用错误文本，不带 owner ID、Provider token 或内部对象细节。
- 回归测试覆盖错误响应中不包含 Bearer token 和 refresh token。

### 21. 生产环境本地认证必须使用 bcrypt

`LocalAuthProvider` 支持 htpasswd 风格文件，并在 `passwordFormat: "auto"` 时根据哈希前缀识别
`bcrypt`、APR1-MD5 和 `{SHA}`。当前实现对无法识别的格式会回退到明文比较，这对本地开发兼容，
但生产环境如果误用 `auto` 或旧哈希格式，会让弱口令材料成为线上登录凭证。

修复要求：

- `NODE_ENV=production` 且启用本地认证时，必须配置非空 `passwordFile`。
- `NODE_ENV=production` 且启用本地认证时，`passwordFormat` 必须显式为 `bcrypt`。
- 开发环境继续兼容旧格式，但对缺失或非 bcrypt 的 `passwordFormat` 给出 warning。
- 生产部署文档和管理后台接入文档说明本地认证只能使用 bcrypt。

### 22. Provider API operation 必须声明 token 类型边界

`allowedOperations` 表示哪些服务端 operation 可以被 SDK 调用，但 operation 的风险还取决于使用
用户 token 还是应用 token。`authen.user_info` 这类接口适合当前用户 token，而租户通讯录等接口
更接近应用级能力。如果 operation 只按名称开放，不声明 token 类型，普通用户可能尝试用自己的
user token 调用高权限 operation，让最终授权退化为第三方平台 scope 的隐式判断。

修复要求：

- `ProviderApiOperationDefinition` 支持声明 `allowedTokenKinds`。
- 未声明 `allowedTokenKinds` 时默认只允许 `user` token，保持现有低权限操作兼容。
- Feishu `contact.user.get` 声明为只允许 `app` token。
- `BaseProviderApiClient` 在渲染路径、获取 token 和发请求前先校验 operation 的 token 类型。
- 文档列出内置 operation 的 token 类型，说明 app token operation 仍需要管理员权限。

### 23. Provider API 响应头不能原样回传

`BaseProviderApiClient` 会读取下游 Provider HTTP 响应，并把 `status`、`headers` 和 `data`
包装成 SDK 响应。若把所有响应头原样放进 JSON，第三方平台的 `set-cookie`、`location`、
内部追踪 ID、租户级限流字段或其它平台元数据会被业务客户端看到。这些信息通常不属于业务 API
契约，也可能增加调试、横向关联或会话混淆风险。

修复要求：

- Provider API 只返回安全响应头 allowlist。
- 默认 allowlist 只包含业务解析必要的 `content-type` 和语言提示类 `content-language`。
- `set-cookie`、`location`、`x-request-id`、限流类和其它 Provider 原始响应头不进入 SDK
  JSON 响应体。
- 回归测试覆盖敏感响应头被过滤。

### 24. 插件注册路径必须保持在自身命名空间内

认证插件可以注册 route、static asset 和 webhook。虽然当前内置插件路径固定，未来扩展插件时，
如果允许 `..`、双斜杠、查询串、片段、百分号编码或反斜杠路径进入 Fastify 注册阶段，插件可能
造成路由混淆，或在反向代理、客户端、框架对路径规范化理解不一致时越过 `/auth/{provider}`
命名空间。

即使 path 本身通过校验，Fastify route 对象里的 `url`、`method` 和 `handler` 仍是敏感字段。
如果把插件返回的 `route.options` 展开到最终 route 对象后面，插件可以通过
`options.url` 或 `options.handler` 覆盖前面计算出的安全路由。

修复要求：

- provider `name` 必须是小写 URL 安全标识。
- route、static asset 和 webhook path 必须以 `/` 开头，并且只包含受限字符集。
- 拒绝 `.`、`..` 路径段、双斜杠、查询串、片段、百分号编码和反斜杠。
- route `options` 不能覆盖协调器计算出的 `url`、`method`、`path` 或 `handler`。
- 路径校验失败时中止 provider 注册，且不能留下半注册 provider。
- 开发者文档说明插件路径安全规则。

### 25. Provider API 必须要求专用 OIDC scope

`providerApi.allowedClientIds` 只能限制哪些 OIDC client 可以调用 SDK 代理，但同一 client
可能同时签发普通登录 access token 和业务 API access token。若 Provider API 不检查专用
scope，任何由白名单 client 签发的普通 token 都可能默认获得第三方 Provider API 代理能力。

修复要求：

- `/api/provider/:provider/request` 必须要求 access token 包含 `provider_api` scope。
- 缺少该 scope 时返回 `403`，且不能进入 `ProviderApiService.request()`。
- 默认配置和示例配置声明 `oidc.claims.provider_api`，方便业务客户端显式申请该 scope。
- 接入文档说明业务客户端发起 OIDC 授权时必须申请 `provider_api` scope。

### 26. 用户外部身份映射必须唯一且不能通过通用编辑改绑

外部身份改绑同时涉及身份映射、OIDC grant、Provider token 和后台 session。通用用户更新无法
跨这些存储提供原子事务；如果先更新身份再撤销凭据，撤销失败会留下新身份绑定和旧令牌并存。
如果允许两个不同 `sub` 共享同一个 `authProvider/externalId`，第三方登录的账号归属也会变得
不确定。

修复要求：

- 后台 `PATCH /admin/api/users/:sub` 必须拒绝 `authProvider` 和 `externalId`。
- 未来如需改绑，应提供具备事务、补偿、全量凭据撤销和审计的专用操作。
- 用户仓储在创建或内部同步外部身份前，必须拒绝已经绑定到其它 `sub` 的
  `authProvider/externalId`。
- memory 仓储更新外部身份时必须删除旧 provider 索引，并只让新身份命中用户。
- SQLite/PostgreSQL 仓储更新外部身份后必须只按当前列值命中用户。
- SQLite/PostgreSQL 仓储必须使用数据库级唯一索引约束非空 `authProvider/externalId`，
  避免并发改绑或直接仓储写入绕过应用层校验。
- 回归测试覆盖通用编辑拒绝改绑，以及重复外部身份被拒绝。

### 27. 模块化启动不能绕过生产配置校验

`loadConfig()` 会对配置文件做 Zod 校验和生产环境安全校验，但 `start(customConfig)` 修复前
直接使用调用方传入的对象。部署方如果用模块化方式集成服务，就可能在 `NODE_ENV=production`
下绕过 HTTPS、非 memory 存储、Provider API client allowlist 和强 cookie key 等上线前置检查。

修复要求：

- `start(customConfig)` 必须和配置文件路径一样执行配置校验。
- 校验失败时必须在初始化 Fastify、OIDC provider、仓储和 token 探活前抛错。
- 保留 `start()` 无参数时通过 `loadConfig()` 加载配置文件的原有行为。
- 用户文档说明模块化传配置也会触发生产环境安全校验。
- 回归测试覆盖生产环境下传入不安全 custom config 会 fail closed。

### 28. 后台登录必须绑定显式匹配的 OIDC client

修复前后台登录固定使用 `clients[0]` 构造 `/admin/login/start` 授权请求和 `/admin/callback`
换码请求。如果第一个 client 是业务应用、缺少后台 callback，或不支持当前换码方式，后台登录会在
授权或换码阶段失败。更重要的是，这让高权限后台入口依赖配置数组顺序，而不是依赖明确的后台
redirect URI 和授权码能力。

修复要求：

- 后台登录只能使用 `redirect_uris` 包含 `${server.url}${admin.basePath}/callback` 的 client。
- 该 client 必须支持 `response_types: ["code"]`、`grant_types` 包含 `authorization_code`，
  且 `token_endpoint_auth_method` 为 `client_secret_basic`。
- 如果第一个 client 不匹配但后续 client 匹配，应选择后续匹配的 admin client。
- 如果没有匹配 client，配置验证必须 fail closed，不能等到用户点击后台登录才失败。
- `server.url` 尾部斜杠不能导致生成 `//admin/callback` 这类偏移 redirect URI。

### 29. Provider API 不能继续使用非 valid 状态的 Provider token

Provider token 仓储会记录 `valid`、`expired`、`refresh_failed`、`revoked` 和 `unknown`
等健康状态。修复前请求路径只按是否存在 token 和是否接近过期判断，未统一检查状态。
这会让被探活标记为异常、刷新失败或本地标记为 revoked 的 token 仍可能继续用于第三方 API
代理调用。

修复要求：

- Provider API 请求发往第三方前，必须再次确认 token `status` 为 `valid`。
- 用户 token 如果是 `revoked` 或 `refresh_failed`，不能继续使用。
- 用户 token 已过期且可刷新时可以尝试刷新，但刷新失败后不能继续使用旧 token。
- app token 缓存如果是 `revoked` 或 `refresh_failed`，不能静默复用或重新启用旧凭证。
- 回归测试覆盖 user token 和 app token 非 valid 状态都不会触发第三方 `fetch()`。

### 30. Provider token 本地 revoked 状态不能被探活复活

`revoked` 表示本服务本地撤销或隔离了某个 Provider token。修复前自动探活调度器会把
`revoked` 视为异常候选继续调用 `probeToken()`；Feishu app token 探活路径甚至会在未调用
第三方接口校验的情况下把未过期 app token 标记回 `valid`。这会破坏撤销语义，让被隔离的
凭证在下一轮巡检或管理员误点探活后重新进入可用状态。

修复要求：

- 自动探活调度器和仓储候选查询都必须跳过 `revoked` token。
- `ProviderApiService.probeToken()` 即使被后台手动探活调用，也不能把 `revoked` 交给下游
  Provider client。
- Feishu app token 探活不能无条件把 app token 写回 `valid`；本地 `revoked` 应保持
  `revoked`。
- 回归测试覆盖调度器、服务层和 Feishu app token 探活三条路径。

### 31. 生产环境不能接受默认 OIDC cookie key 和默认客户端密钥

`oidc.cookieKeys` 是 OIDC 交互和会话 cookie 的根密钥，`clients[].client_secret` 是
授权码换 token 的客户端认证凭证。修复前生产配置只会对示例默认值和短客户端密钥给出
warning；部署者如果忽略启动日志，服务仍会带着可预测密钥上线。

修复要求：

- `NODE_ENV=production` 下，示例默认 `oidc.cookieKeys` 必须阻止启动。
- `NODE_ENV=production` 下，短于 16 字符的 `clients[].client_secret` 必须阻止启动。
- `NODE_ENV=production` 下，示例默认 `clients[].client_secret` 必须阻止启动。
- 文档明确这些配置是 fail-closed 校验，而不是普通建议。

### 32. Provider API pathParams 必须限制为安全单路径段

Provider API 已把 `operation` 绑定到服务端维护的路径模板，但模板中的 `pathParams` 仍由
SDK 调用方提供。如果允许 `/`、`\`、`%2F`、`%2e%2e`、`?` 或 `#` 这类值进入路径模板，
部分上游代理或 Provider 服务可能在服务端构造 URL 之后再次解码或规范化路径，导致请求落到
非预期资源。

修复要求：

- `pathParams` 必须先通过标量校验，再限制为安全 URL 单路径段。
- 只允许 ASCII 字母、数字、`.`、`_`、`~` 和 `-`。
- 拒绝 `.` 和 `..` 两个特殊段。
- 拒绝非有限数字，避免把 `NaN` 或 `Infinity` 这类非业务值渲染进 Provider URL。
- 回归测试覆盖 encoded slash、dot-segment、反斜杠、查询串和片段分隔符。

### 33. 插件 middleware 必须按路径段限制在自身命名空间内

`PluginMiddlewareContext.addHook()` 修复前使用 `request.url.startsWith(basePath)` 判断插件
中间件作用范围。若存在 `feishu` 和 `feishu2` 这类同前缀 provider，`/auth/feishu2/...`
也会触发 `feishu` 插件 middleware。未来如果插件 middleware 添加鉴权、改写响应头或读取请求体，
这会破坏插件隔离边界。

修复要求：

- 使用 URL pathname 判断请求路径，不直接在包含 query 的 `request.url` 上做字符串前缀判断。
- 只允许 pathname 等于 `/auth/{provider}` 或以 `/auth/{provider}/` 开头。
- `/auth/{provider}2`、`/auth/{provider}-extra` 等同前缀路径不能触发该 provider 的 middleware。
- 开发者文档中的示例也必须展示路径段匹配，避免插件作者复制不安全模式。

### 34. OIDC issuer 必须绑定当前服务的 `/oidc` 挂载路径

服务端固定把 `oidc-provider` 挂载在 `/oidc`。修复前生产配置只校验 `oidc.issuer` 是否使用
HTTPS，没有校验它是否等于 `${server.url}/oidc`。如果 issuer 指向其它 Origin，后台
`/admin/login/start` 会把管理员跳转到外部 `/auth`，`/admin/callback` 也会向外部 `/token`
换码；如果 issuer 缺少 `/oidc`，发现文档和实际挂载路径会不一致。

修复要求：

- `oidc.issuer` 必须等于 `${server.url}/oidc`，允许尾部斜杠归一化。
- 该校验应作为通用运行时配置错误，不只在生产环境提示。
- 错误消息必须给出期望的 issuer，方便部署者修复。
- 文档中不再把 `oidc.issuer` 描述为任意 HTTPS 地址，而是明确绑定服务端固定挂载路径。

### 35. Provider API bearer token 必须绑定有效 client 和 grant

Provider API 代理路由需要把 OIDC access token 映射为当前用户。修复前本地工具只调用
`AccessToken.find()`，再检查 `accountId`、`exp` 和用户状态；但 `oidc-provider` 自己的
受保护端点还会加载关联 client 和 grant，并拒绝缺失、过期或与 token 不匹配的 grant。
如果 Provider API 绕过这层校验，配置变更后已删除的 client、异常残留的 access token，
或 grant 状态不一致的 token 可能继续触达第三方 Provider API 代理。

修复要求：

- access token 必须是可用的 `AccessToken`，且 `isValid` 不能为 `false`。
- access token 必须带 `clientId` 和 `grantId`。
- `clientId` 必须能通过当前 `oidcProvider.Client.find()` 找到。
- `grantId` 必须能通过当前 `oidcProvider.Grant.find(..., { ignoreExpiration: true })` 找到，
  且 grant 不能已过期。
- grant 的 `clientId` 和 `accountId` 必须分别等于 access token 的 `clientId` 和
  `accountId`。
- 以上任一条件失败时，Provider API 按无效 bearer token 返回 `401`，且不能进入
  `ProviderApiService.request()`。

### 36. 公开 URL 配置不能包含 query 或 fragment

`server.url`、`oidc.issuer` 和 `server.corsOrigins` 都是安全边界配置。修复前
`oidc.issuer` 与 `${server.url}/oidc` 比较时会丢弃 query 和 fragment，因此
`https://id.example.com/oidc?x=1` 或 `#fragment` 这类值可能通过绑定校验。CORS allowlist
也只应配置浏览器 `Origin`，不能带 path、query 或 fragment。

修复要求：

- `server.url` 禁止包含 query 或 fragment。
- `oidc.issuer` 禁止包含 query 或 fragment，并继续要求等于 `${server.url}/oidc`。
- `server.corsOrigins` 每一项必须是纯 Origin，不能包含 path、query 或 fragment。
- 错误应在配置验证阶段 fail-closed，不等到 Fastify、OIDC provider 或 CORS 插件启动后才暴露。
- 生产部署文档、模块化使用文档和 Provider API 接入文档同步说明这些 URL 边界。

### 37. JWKS 私钥文件必须使用 owner-only 权限

`jwks.json` 包含 OIDC token 签名私钥。修复前 `generateJWKS()` 只调用
`writeFileSync(filePath, ...)`，文件权限会受进程 umask 影响；在 umask 过宽的环境中，私钥文件
可能以 group/other 可读权限创建。同机其它用户或容器内非服务进程一旦读取该私钥，就能伪造
本服务签发的 token。

修复要求：

- 自动生成 JWKS 文件时显式使用 `0600` 权限。
- 加载已有 JWKS 文件前，如果发现 group/other 访问位，应先收紧到 `0600`。
- 手动生成脚本复用同一生成函数，不能绕过权限收紧。
- 生产部署文档说明服务会自动收紧权限，但部署者仍应确认 `jwks.json` 不进入镜像、仓库或非服务
  用户可读的位置。

### 38. Provider API baseUrl 需要生产 HTTPS 和稳定边界

`providerApi.providers.<provider>.baseUrl` 是第三方 Provider token 的出站端点。修复前只做
URL 格式校验，生产环境仍可能配置成 `http://...`，导致 access token 或 app secret 相关请求经
明文链路发送；同时带 userinfo、query 或 fragment 的 base URL 会让 Provider API 代理边界不稳定，
不利于审计和排障。

修复要求：

- 仅在 `providerApi.enabled` 且具体 provider `enabled` 时校验该 provider 的 `baseUrl`。
- `baseUrl` 只允许 HTTP/HTTPS 协议。
- `baseUrl` 不能包含用户名、密码、query 或 fragment。
- `NODE_ENV=production` 下，启用的 Provider API provider 的 `baseUrl` 必须使用 HTTPS。
- 用户接入文档和生产部署文档同步说明该出站边界。

### 39. Provider API 出站请求必须有超时边界

Provider API 代理请求、Provider app token 获取和用户 token 刷新都会访问第三方平台。修复前这些
`fetch()` 调用没有显式超时，授权调用方或第三方网络异常可以让请求长时间挂起，放大连接、内存和
并发资源占用。

修复要求：

- 新增 `providerApi.requestTimeoutMs` 配置并提供安全默认值。
- 配置 schema 限制该值只能在合理范围内，避免被配置成无界等待或过大值。
- Provider API 代理请求必须带 abort signal。
- Feishu app token 获取和用户 token 刷新也必须带同一超时边界。
- 用户接入文档、生产部署文档、模块化使用示例和示例配置同步说明该配置。

### 40. Provider API 第三方响应体读取必须有字节上限

Provider API 代理请求、Provider app token 获取和用户 token 刷新都会读取第三方平台响应体。只加
`requestTimeoutMs` 能限制慢响应时间，但不能限制第三方返回超大 JSON/text 时的一次性内存占用。
授权调用方如果能触发大响应，或第三方异常返回大响应，仍可能造成服务端内存放大。

修复要求：

- 新增 `providerApi.responseBodyLimitBytes` 配置并提供安全默认值。
- 配置 schema 限制该值只能在合理范围内，避免配置成过小导致常规响应不可用，或过大削弱保护。
- Provider API 代理响应读取必须先检查 `content-length`，并在流式读取时累计字节数。
- 超过上限时必须取消剩余响应读取并返回稳定错误，错误内容不能包含第三方响应体。
- Feishu app token 获取和用户 token 刷新也必须使用同一响应体上限。
- 用户接入文档、生产部署文档、模块化使用示例和示例配置同步说明该配置。

### 41. 后台 callback 必须校验 access token 绑定后台客户端和有效 grant

后台 `/admin/callback` 使用后台客户端交换授权码后，会根据返回的 access token 查找用户并创建
后台 BFF session。修复前只读取 token 的 `accountId`，没有再次校验 token 的 `clientId`、
`grantId` 和 grant 绑定关系。正常 oidc-provider token endpoint 会校验授权码和客户端，但后台
session 创建是高权限边界，不能把“token endpoint 一定返回正确 token”作为唯一假设。

风险场景：

- token 存储、测试替身或后续重构错误地让 callback 读到非后台客户端的 access token。
- grant 已过期、grant 与 token 的 `clientId` 或 `accountId` 不一致时，后台仍可能基于
  `accountId` 建立 cookie session。

修复要求：

- 后台 callback 必须要求 access token 存在 `accountId`、`clientId` 和 `grantId`。
- `clientId` 必须等于当前选中的后台客户端。
- token 不能过期、不能显式无效，且 `kind` 若存在必须为 `AccessToken`。
- 必须通过 `Client.find()` 确认客户端仍存在，并通过 `Grant.find(..., { ignoreExpiration: true })`
  确认 grant 未过期且绑定同一 `clientId` 和 `accountId`。
- 校验失败时不设置后台 cookie、不跳转到管理台。

### 42. 后台页面和静态资源必须设置浏览器安全响应头

管理后台使用 HttpOnly cookie session，是高权限浏览器页面。修复前后台 SPA HTML 由
`src/routes/adminRoutes.ts` 直接读取 `public/admin/index.html` 后返回，`/admin/assets/*` 则由
`@fastify/static` 从 `public/` 暴露，二者都没有统一设置 CSP、frame 限制和内容嗅探防护头。

风险场景：

- 管理台页面可被第三方站点嵌入 iframe 时，管理员可能被诱导点击后台操作入口，和现有 CSRF
  防护叠加后仍会扩大点击劫持面。
- 静态资源缺少 `X-Content-Type-Options: nosniff` 时，浏览器或中间代理的 MIME 行为更难预测。
- 缺少 `Referrer-Policy` 时，从后台跳转或加载资源时可能泄露后台路径。

修复要求：

- 后台 HTML 响应必须设置 CSP，至少限制 `script-src 'self'`、`object-src 'none'`、
  `base-uri 'self'`、`form-action 'self'` 和 `frame-ancestors 'none'`。
- 后台 HTML 和 `public/admin/` 下的静态资源必须设置 `X-Frame-Options: DENY`、
  `X-Content-Type-Options: nosniff`、`Referrer-Policy: same-origin` 和
  `Cross-Origin-Opener-Policy: same-origin`。
- 只对 `public/admin/` 文件追加后台安全头，避免影响其它公开静态资源。
- 用户文档同步说明后台浏览器安全响应头边界。

### 43. 统一登录页必须约束 Provider UI 渲染面

统一登录页 `/interaction/:uid` 是未认证入口，会渲染本地密码表单和 OAuth Provider 按钮。修复前
Local 表单 action 直接拼接 `interactionUid`，OAuth 按钮只做 HTML 转义但不限制 URL scheme，
且页面没有 CSP、frame、nosniff 等浏览器安全头。

风险场景：

- 如果后续交互路由或测试替身让非预期 UID 进入渲染路径，未转义 UID 会进入 `action` 属性。
- Provider UI 返回 `javascript:` 或协议相对地址时，统一登录页可能生成可点击的脚本链接或
  非预期跨站跳转入口。
- Provider 的 HTML 片段属于高信任扩展面，一旦某个 provider 漏转义，缺少 CSP 会放大为公开
  未登录页面脚本执行风险。

修复要求：

- Local 登录表单 action 和 OAuth callback complete 跳转中的 `interactionUid` 必须先按 URL
  路径段编码；进入 HTML 属性前还必须按属性上下文转义。
- 统一登录页 OAuth `href` 和 `img src` 只接受 HTTP(S) URL 或站内绝对路径，拒绝
  `javascript:`、协议相对地址、控制字符和其它非预期 scheme。
- `/interaction/:uid` HTML 响应必须设置 CSP，至少包含 `script-src 'none'`、
  `object-src 'none'`、`base-uri 'self'`、`form-action 'self'` 和 `frame-ancestors 'none'`。
- 登录页还应设置 `X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff` 和
  `Referrer-Policy: same-origin`。
- Provider 返回的 raw HTML 片段继续视为可信插件代码；普通可配置文本、URL 和图标字段仍需由
  统一渲染器做边界处理。

## P3 延后记录

- `admin.basePath` 已支持服务端配置，但管理台前端仍硬编码 `/admin/api` 和 `/admin` 相关路径。
  这会导致自定义后台路径部署失败；安全影响目前偏可用性和配置一致性，先按 P3 记录。
- Provider API 已有 query/header/body 最小授权；后续若开放写操作或高权限查询，应在
  `allowBody` 之外继续增加 operation 级 body schema。
- Feishu webhook 运行时已经在缺少 `encryptKey` 时 fail-closed；配置检查现在只给出 warning，
  后续如果决定把 webhook 配置做成显式开关，可进一步把启用 webhook 且缺少 `encryptKey` 升级为
  schema 错误。
- `LocalAuthProvider` 运行时仍保留 `auto` 对旧 htpasswd 格式和明文的开发兼容；生产环境已经在
  配置验证层 fail-closed，暂不移除开发兼容行为。
- 后台用户 API 已有默认分页上限，但管理台前端还没有服务端分页 UI；超过默认返回数量的用户需要
  后续通过服务端分页或筛选 UI 补齐可用性。
- PostgreSQL 用户仓储和 Provider token 仓储的 host-style 配置会拼接成连接字符串；
  如果用户名、密码或数据库名包含 `@`、`:`、`/` 等保留字符，可能造成连接失败或 URI 语义混淆。
  当前属于部署配置鲁棒性问题，后续可改为 URI 组件编码或直接向 `pg.Pool` 传结构化连接参数。

## 备选方案

- 关闭 `providerApi.sdkProxy` 作为临时缓解措施：可以降低 Provider API 代理风险，
  但不能解决后台 token 明文返回和后台管理权限问题。
- 完全禁用内置管理后台：可减少攻击面，但会失去 `feat/v2` 的主要管理能力。
- 只依赖文档提醒用户修改默认配置：不足以防止误部署，关键高权限默认值应在代码层安全。

## TODO

- [x] 在 `BaseProviderApiClient` 或上层服务中实现服务端 operation 到 `method/path` 的绑定。
- [x] 为 Provider API 代理补充绕过测试：允许的 `operation` 不能访问未绑定路径。
- [x] 为 `/admin/api/tokens` 新增摘要 DTO，剔除所有明文 token 字段。
- [x] 为 token 列表补充测试，断言响应不包含 `accessToken` 和 `refreshToken`。
- [x] 调整 Feishu 组映射和 `admin.allowedGroups` 默认值，避免普通登录用户默认成为管理员。
- [x] 为后台管理员判断补充测试，覆盖普通 Feishu 用户不能访问后台 API。
- [x] 为后台 mutation 接口增加 CSRF 或 `Origin` 校验。
- [x] 为后台 session cookie 在 HTTPS 配置下追加 `Secure` 并补测试。
- [x] 为 OIDC、Feishu、Provider 探活相关日志增加脱敏和摘要输出，并补日志脱敏测试。
- [x] 通用日志脱敏覆盖 `Error.message` 和非敏感字段名下的 token-like 字符串。
- [x] `AuthCoordinator` 的 Fastify `app.log` 错误对象不再输出原始 Error。
- [x] 将 CORS 默认值改为关闭，新增 `server.corsOrigins` allowlist 配置和测试。
- [x] 为后台用户 API 增加 `AdminUser` 摘要 DTO，避免下发 Provider 原始档案和 metadata。
- [x] 为 Provider API 增加 operation 级 query/header/body 边界和标量参数校验。
- [x] 为 Provider API 增加运行时请求体结构校验，避免非法 `tokenKind` fail-open 到用户 token。
- [x] 为后台用户创建和编辑增加字段白名单，并禁止通用编辑修改外部身份绑定。
- [x] 为后台 OAuth 登录 state 增加 TTL、一次性消费和容量上限。
- [x] 配置文件存在但加载或解析失败时阻止启动，不再回退默认配置。
- [x] `NODE_ENV=production` 且配置文件不存在时阻止启动，避免误用开发默认配置。
- [x] 非生产环境无配置文件时，开发默认配置也执行统一配置校验，避免默认兜底绕过 schema。
- [x] `NODE_ENV=production` 下拒绝非 HTTPS 公开 URL、回调 URL、CORS Origin 和 memory 存储。
- [x] 为 Provider API SDK 代理增加 OIDC `client_id` allowlist，并在生产环境要求显式配置。
- [x] 飞书认证启用但缺少 `encryptKey` 时输出配置告警。
- [x] 为 Provider token 错误摘要、探活调度器日志和仓储 `lastError` 边界增加 token-like
  文本脱敏。
- [x] token-like 文本脱敏覆盖 `app_access_token`、`tenant_access_token`、
  `user_access_token`、`appAccessToken` 等带 Provider 前缀的 token key。
- [x] 为 Feishu webhook 和 callback URL 验证增加 fail-closed token/timestamp 校验。
- [x] 将 Feishu webhook 签名密钥改为 `encryptKey`，并在 handler 中校验 payload token。
- [x] 将后台 API 收敛为 BFF session cookie-only，并拒绝 OIDC bearer token。
- [x] 移除 OAuth state 校验时枚举并打印所有临时 state/auth_result 的调试日志。
- [x] 为后台用户列表查询增加字段白名单和仓储层排序字段校验。
- [x] 为后台用户列表增加默认分页上限，避免未传 `limit` 时全量读取用户表。
- [x] 为后台 Provider token 列表和手动探活增加字段白名单、枚举校验和分页上限。
- [x] 为后台 Provider token 列表增加默认分页上限，避免未传 `limit` 时全量解密。
- [x] 为 Provider API caller header 增加保留 header 黑名单和格式校验。
- [x] 为 Provider token 自动探活增加候选查询和每轮批量上限，避免全表解密扫描。
- [x] 为 Provider API 代理错误响应增加 token-like 文本脱敏。
- [x] 为后台 BFF session 增加过期清理和容量上限，避免会话表无界增长。
- [x] 将本地登录失败计数接入 stateStore，并避免为不存在的用户名创建状态。
- [x] 让 PostgreSQL 用户仓储和 Provider token 仓储等待表初始化完成后再执行首个操作。
- [x] 让 `start()` 启动阶段失败路径复用统一资源清理流程，并关闭用户仓储连接。
- [x] 为 Feishu webhook 验签捕获原始 HTTP body，避免重新 stringify 导致签名不兼容。
- [x] 生产环境启用本地认证时，要求 `passwordFile` 非空且 `passwordFormat` 显式为 `bcrypt`。
- [x] 生产环境拒绝示例默认 `oidc.cookieKeys`、短 `client_secret` 和示例默认
  `client_secret`。
- [x] 为 Provider API operation 增加 `allowedTokenKinds`，并限制 Feishu 通讯录查询只能使用
  app token。
- [x] Provider API 响应头只返回安全 allowlist，避免原样暴露第三方响应头。
- [x] 为认证插件 route、static asset 和 webhook 增加路径规范化校验。
- [x] 过滤插件 route `options` 中的 `url`、`method`、`path` 和 `handler`，避免绕过
  `/auth/{provider}` 路由边界。
- [x] 插件 middleware 按 URL pathname 路径段匹配自身 `/auth/{provider}` 命名空间，避免同前缀
  provider 路径被误命中。
- [x] 为 Feishu 加密 URL 验证解析官方 `msg_len`/`app_id` 格式，并拒绝 `app_id` 不匹配的密文。
- [x] 为 Provider API SDK 代理增加 `provider_api` OIDC scope gate。
- [x] 为用户仓储补齐外部身份唯一性校验，并修复 memory 仓储改绑后旧 provider 索引残留。
- [x] 为 SQLite/PostgreSQL 用户仓储补齐数据库级外部身份唯一索引。
- [x] 为 `start(customConfig)` 补齐配置校验，避免模块化启动绕过生产安全检查。
- [x] 后台登录改为选择显式匹配 admin callback 的 OIDC client，并在配置验证层拒绝缺失匹配
  client 的配置。
- [x] Provider API 发出第三方请求前只接受 `valid` Provider token，拒绝继续使用 revoked、
  refresh_failed 或 unknown token。
- [x] `revoked` Provider token 不会被自动探活、后台手动探活或 Feishu app token 探活恢复为
  `valid`。
- [x] 为 Provider API pathParams 增加安全单路径段校验，避免 encoded slash 或 dot-segment
  造成 Provider URL 路径混淆。
- [x] 为 `oidc.issuer` 增加 `${server.url}/oidc` 绑定校验，避免后台登录和发现文档指向错误地址。
- [x] 为 Provider API bearer token 解析补齐 OIDC client 和 grant 有效性校验。
- [x] 为 `server.url`、`oidc.issuer` 和 `server.corsOrigins` 增加 query/fragment/path
  语义校验。
- [x] 为 JWKS 私钥文件生成和加载路径补齐 `0600` 权限收紧，并补测试。
- [x] 后台 mutation 的 `Referer` fallback 改为后台路径段匹配，避免同源前缀路径误通过。
- [x] 为启用的 Provider API provider `baseUrl` 增加协议、userinfo、query/fragment 和生产
  HTTPS 校验。
- [x] 为 Provider API 代理请求、Feishu app token 获取和用户 token 刷新增加
  `providerApi.requestTimeoutMs` 超时边界，并同步配置 schema、示例、文档和测试。
- [x] 为 Provider API 代理响应、Feishu app token 获取和用户 token 刷新增加
  `providerApi.responseBodyLimitBytes` 响应体字节上限，并同步配置 schema、示例、文档和测试。
- [x] 为后台 OAuth callback 增加 access token 的后台客户端、有效 grant 和账号绑定校验，
  避免非后台 client 或 grant 不匹配的 token 建立后台 session。
- [x] 为后台 HTML 和 `public/admin/` 静态资源增加 CSP、frame、nosniff、referrer 和 opener
  安全响应头，并同步文档和测试。
- [x] 为统一登录页 Local 表单 action 和 OAuth callback complete 跳转增加 `interactionUid`
  路径段编码，并在 HTML 属性上下文继续转义。
- [x] 为统一登录页 OAuth 按钮 URL 增加 scheme 白名单，拒绝 `javascript:` 和协议相对地址。
- [x] 为 `/interaction/:uid` HTML 响应增加 CSP、frame、nosniff 和 referrer 安全头，并补测试。
- [x] 同步更新 `docs/ADMIN_AND_PROVIDER_API.md`、`docs/PRODUCTION_SETUP.md`、
  `docs/SERVER_USAGE.md`、`README.md` 和示例配置中的安全说明。
- [x] 运行并通过聚焦测试、全量测试、Biome 检查、管理台构建、服务端打包、
  类型声明生成和 Markdown lint。
- [ ] 继续对 `feat/v2` 做下一轮对抗 review，收集 P3 或剩余设计风险。

## 验收标准

- [x] 普通用户无法通过伪造 `operation` 访问未授权的 Provider API 路径。
- [x] 后台 token API 的响应体不包含 `accessToken`、`refreshToken` 或其它密钥字段。
- [x] 默认配置下，非显式授权用户不能访问后台管理 API。
- [x] cookie 会话发起的后台写请求具备 CSRF 防护。
- [x] HTTPS 部署下后台 session cookie 包含 `Secure`。
- [x] 调试日志不输出密码、OAuth code、第三方 token、Feishu 解密事件原文或用户原始档案。
- [x] 第三方 SDK 或网络库把 token-like 文本放进 `Error.message` 时，日志脱敏仍会移除敏感值。
- [x] provider 初始化、认证和 OIDC interaction 错误经 Fastify logger 输出时不会保留原始
  token-like 错误文本。
- [x] 默认配置不对任意 Origin 开放 CORS，跨域浏览器 SDK 必须配置显式 allowlist。
- [x] 后台用户 API 不返回 `metadata`、`providerProfile.raw` 或 Provider 原始用户档案。
- [x] Provider API 的 query/header/body 只按 operation 定义转发，默认拒绝未声明参数。
- [x] Provider API 的路径模板参数不能包含 slash、percent 编码、dot-segment 或查询片段分隔符。
- [x] Provider API 非法请求体结构不会进入下游 Provider client。
- [x] 后台用户写接口拒绝 `metadata`、`providerProfile`、`emailVerified` 等非表单字段。
- [x] 后台 OAuth 登录 state 一次性消费、会过期，并在超过上限时淘汰旧 state。
- [x] 生产环境缺少配置文件、JS/JSON 配置文件加载或解析失败时不会回退默认配置继续启动。
- [x] 非生产环境无配置文件时返回的开发默认配置不会绕过 Zod 和运行时配置校验。
- [x] 生产环境不会接受明文公开 URL、回调 URL、CORS Origin 或 memory 存储配置。
- [x] Provider API SDK 代理不会接受不在 allowlist 中的 OIDC client access token。
- [x] Provider token `lastError` 和探活日志不保留 token-like 错误文本，即使仓储调用方直接传入
  原始错误文本也会被脱敏。
- [x] 错误摘要和日志脱敏不会保留 `app_access_token`、`tenant_access_token`、
  `user_access_token` 或 camelCase Provider token key 的值。
- [x] Feishu webhook 缺少 `encryptKey`、payload token 不匹配或签名时间戳过期时会被拒绝。
- [x] Feishu 加密 callback payload 的尾部 `app_id` 必须匹配配置 `appId`。
- [x] 后台 API 拒绝 OIDC bearer token，只接受后台 session cookie。
- [x] OAuth state 校验不会把 state store 中的完整临时认证数据写入日志。
- [x] 后台用户列表查询不会把任意 `sortBy` 拼入 SQL，非法查询会被拒绝。
- [x] 后台用户列表未传 `limit` 时不会全量读取用户表。
- [x] 后台 Provider token 列表和探活不会接受非法 ownerType/status、负数分页或未知字段。
- [x] 后台 Provider token 列表未传 `limit` 时不会全量读取和解密 token 表。
- [x] Provider API 不会转发调用方提交的凭证类、路由类或格式异常 header。
- [x] Provider token 定时探活不会默认每轮读取和解密整张 token 表。
- [x] Provider API 代理错误响应不会回显下游异常中的 Bearer token 或 refresh token。
- [x] 后台 BFF session 不会在进程内无界增长。
- [x] 随机不存在用户名不会撑大本地登录失败状态，多实例共享同一失败计数。
- [x] PostgreSQL 用户和 Provider token 首次查询或写入不会早于表初始化。
- [x] 服务器启动阶段失败时会清理已创建的运行时资源，包括用户仓储连接。
- [x] Feishu webhook 签名使用原始 HTTP body，而不是解析后重新序列化的 body。
- [x] 生产环境本地认证不会接受缺失 `passwordFile`、`auto`、`md5` 或 `sha` 密码格式配置。
- [x] 生产环境不会接受示例默认 `oidc.cookieKeys`、短 `client_secret` 或示例默认
  `client_secret`。
- [x] Provider API operation 会在请求发往第三方前校验 token 类型，Feishu 通讯录查询不会接受
  普通用户的 user token。
- [x] Provider API SDK 响应不会包含下游 `set-cookie`、`location` 或内部追踪类响应头。
- [x] 认证插件不能注册包含 `..`、双斜杠、查询串、片段或编码混淆的 route/static/webhook path。
- [x] 认证插件不能通过 route `options` 覆盖已校验的 `url`、`method` 或 `handler`。
- [x] 认证插件 middleware 不会作用到同前缀的其它 provider 路径。
- [x] Provider API SDK 代理拒绝缺少 `provider_api` scope 的 OIDC access token。
- [x] 后台通用编辑拒绝外部身份改绑，重复外部身份会被仓储层拒绝。
- [x] SQLite/PostgreSQL 用户仓储在数据库层约束非空 `authProvider/externalId` 唯一。
- [x] `start(customConfig)` 在生产环境会拒绝 HTTP 公网 URL、memory 存储等不安全配置。
- [x] 后台登录不会隐式使用 `clients[0]`；没有显式匹配后台 callback 的授权码 client 时配置验证失败。
- [x] Provider API 不会使用非 valid 状态的 Provider token 发起第三方请求。
- [x] `revoked` Provider token 不会被自动巡检或手动探活重新启用。
- [x] `oidc.issuer` 不等于 `${server.url}/oidc` 时配置验证失败。
- [x] Provider API bearer token 对应的 OIDC client 缺失、grant 缺失、grant 过期或
  grant 与 token 不匹配时，请求不会进入第三方 Provider API 代理。
- [x] `server.url` 或 `oidc.issuer` 带 query/fragment 时配置验证失败；`server.corsOrigins`
  带 path、query 或 fragment 时配置验证失败。
- [x] 自动生成或加载已有 JWKS 文件时，私钥文件不会保留 group/other 可读权限。
- [x] 后台 mutation 的 `Referer` fallback 不会把 `/admin2` 等同源前缀路径当作后台来源。
- [x] 生产环境不会接受启用的 Provider API provider 使用非 HTTPS `baseUrl`，且任意环境都会拒绝
  启用 provider 的 `baseUrl` 带 userinfo、query、fragment 或非 HTTP(S) 协议。
- [x] Provider API 代理、Feishu app token 获取和用户 token 刷新不会无界等待第三方响应；
  `providerApi.requestTimeoutMs` 有默认值和 schema 范围校验，出站请求会带 abort signal。
- [x] Provider API 代理、Feishu app token 获取和用户 token 刷新不会无界读取第三方响应体；
  `providerApi.responseBodyLimitBytes` 有默认值和 schema 范围校验，超限响应会被拒绝。
- [x] 后台 callback 不会基于非后台客户端、无效 token、过期 grant 或 grant 绑定不一致的
  access token 建立后台 session。
- [x] 后台 HTML 和 `public/admin/` 静态资源带有防点击劫持、内容嗅探和 referrer 泄露的
  浏览器安全响应头。
- [x] 统一登录页不会把未编码或未转义的 `interactionUid` 放入 Local 登录表单 action 或
  OAuth callback complete 跳转。
- [x] 统一登录页不会渲染 `javascript:`、协议相对地址或其它非 HTTP(S)/站内路径的 OAuth 按钮。
- [x] 统一登录页 HTML 带有 `script-src 'none'`、`frame-ancestors 'none'`、nosniff 和 referrer
  安全响应头。
- [x] 相关单元测试覆盖上述安全边界。
- [x] `pnpm lint`、`pnpm test` 和 `pnpm lint:md` 通过，或记录无法运行的原因。

## 退出条件

满足以下任一条件后，本草案应被迁移或删除：

- 安全问题已修复，持久化安全约定已迁移到 `docs/dev/` 或正式部署文档。
- 维护者确认部分问题不成立，并在本草案中记录理由后删除无效 TODO。
- `feat/v2` 中相关能力被移除或重做，本草案不再反映当前实现。
