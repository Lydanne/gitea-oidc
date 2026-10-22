# UI 设计与组件约定

本文面向前端与认证页面维护者，说明当前 UI 技术选型、渲染边界和验证方式。

## 当前技术选型

| 页面范围 | 技术与组件 | 维护入口 |
| --- | --- | --- |
| 管理台登录页 | Vue 3、shadcn-vue Button / Card、Reka UI、Tailwind CSS 4 | `apps/admin-web/src/views/LoginView.vue` |
| 其他管理页面 | Vue 3、PrimeVue 4、PrimeIcons | `apps/admin-web/src/main.ts`、`apps/admin-web/src/styles.css` |
| 统一认证登录页 | 服务端 TypeScript 输出 HTML / CSS，采用 shadcn neutral 风格 | `packages/server-core/src/ui/loginPageRenderer.ts` |
| 用户门户 | Vue 3 与现有页面样式，尚未接入 shadcn-vue | `apps/portal-web/src/` |

[shadcn/ui](https://ui.shadcn.com/) 是本项目登录界面的组件与视觉选型来源；管理台使用其
Vue 社区实现 [shadcn-vue](https://www.shadcn-vue.com/)，没有引入 React。
统一认证页只复用视觉约定，不加载 Vue / Reka UI 运行时，也不依赖管理台的 Tailwind 构建产物。

当前接入范围是两个登录入口。维护其他页面时先沿用所在页面的组件体系；扩大 shadcn-vue
迁移范围应作为明确的改造任务，不因修改一个页面就替换整个管理台或门户。

## shadcn-vue 组件维护

- 配置位于 `apps/admin-web/components.json`，使用 `new-york-v4`、`neutral` 和 CSS 变量主题。
- 组件源码放在 `apps/admin-web/src/components/ui/`，属于项目源码；修改时保留该目录的 MIT
  许可证和来源说明，不编辑 `node_modules`。
- Button 使用 Reka UI 的 Primitive 处理元素类型与属性透传，样式变体由
  `class-variance-authority` 管理，`cn` 合并条件类名。
- 优先复用现有 Button、Card 及子组件。业务文案、认证跳转和返回地址校验留在业务页面，
  不放入通用组件。
- `components.json` 的 `iconLibrary: lucide` 是生成器选项，不代表已安装 Lucide 图标包。
  当前登录页图标直接使用内联 SVG。

在仓库根目录按需添加组件，例如：

```bash
pnpm --dir apps/admin-web dlx shadcn-vue@latest add input
```

运行后检查组件源码、依赖、锁文件及主题变更，避免生成器覆盖现有样式或引入无关组件。
CLI 用法以 [shadcn-vue 文档](https://www.shadcn-vue.com/docs/cli) 为准。

## 样式与交互

`apps/admin-web/src/shadcn.css` 负责 Tailwind 主题映射，主题变量限定在 `.shadcn-theme`
容器内，使用 `--ui-*` 命名，避免覆盖现有 PrimeVue 页面使用的变量。
只导入 Tailwind 的 theme 和 utilities，不引入全局 preflight；增加组件时检查其是否依赖
重置样式，并在组件或限定作用域内补齐。

登录界面使用 neutral 黑白主色、浅边框、轻阴影和清晰的标题层级。新增状态需覆盖键盘焦点、
错误、禁用和窄屏展示；颜色与尺寸以当前源码为准，管理台优先复用主题变量与通用组件。
统一认证页另有原生 CSS 实现，调整登录主题时要核对两个入口的一致性。

表单保留可访问标签、`autocomplete`、正确的输入类型和可见焦点。移动端避免横向溢出，
密码错误提示使用 `role="alert"`，不增加没有后端能力的“忘记密码”等入口。

管理台在 `router.isReady()` 后挂载应用。不要提前触发公开登录页的后台鉴权请求，
否则初始路由尚未解析时可能重复跳转到登录页。

## 认证页和图标约束

统一认证页的 CSP 使用 `script-src 'none'`，所以不能直接复制需要客户端 JavaScript 的
shadcn 交互组件，也不能用内联事件实现密码切换、图标加载失败处理等功能。
不要为了引入 UI 组件而放宽 CSP；若确实需要交互，应先设计符合认证安全边界的方案。

单一可见跳转按钮的自动登录使用原生 `meta refresh` 等待 3 秒，并以 CSS 分步动画显示数字，
不加载脚本。倒计时目标与按钮共用经过校验和转义的 URL；表单、多入口、错误返回和
`autoLogin=0` 不触发。取消链接回到当前交互并设置 `autoLogin=0`，登录目标和 OAuth state 仍由 Provider 生成。
显式配置 `auth.autoRedirectSingleProvider=true` 时，服务端仍优先直接返回 `302`。

认证表单的 action、一次性 interaction 标识、OAuth state、隐藏字段以及 URL / HTML 转义
属于认证行为，视觉调整时保持这些契约。修改此类行为时同时使用认证专项技能和对应测试。

品牌与操作图标优先使用内联 SVG；Provider 图标优先使用插件自己注册的同源资源，
避免把登录体验依赖于外部 CDN 或图标字体。若使用字体或图片，检查实际响应类型、资源路径、
CSP 和浏览器加载结果，不能只检查图标容器是否存在。

飞书按钮和插件元数据目前统一使用 `/auth/feishu/logo.svg`；`/auth/feishu/icon.svg`
保留兼容。替换缓存时间较长的图标时考虑资源 URL 的缓存，避免用户仍看到旧图。

## 验证与产物

按改动范围执行以下命令，均从仓库根目录运行：

```bash
pnpm build:libs
pnpm --filter @x-oidc/admin-web test
pnpm --filter @x-oidc/admin-web typecheck
pnpm --filter @x-oidc/server-core exec vitest run \
  src/ui/__tests__/loginPageRenderer.test.ts \
  src/providers/__tests__/LocalAuthProvider.test.ts \
  src/providers/__tests__/FeishuAuthProvider.test.ts
pnpm lint
pnpm build
```

`pnpm build:libs` 为类型检查准备 workspace 依赖产物。避免将类型检查或依赖这些产物的测试
与会清理、重建相同产物的构建命令并发执行。涉及门户时补跑该包的测试与类型检查；只改文档时
运行 `pnpm lint:md`，无需执行整套运行时构建。

浏览器验收至少检查受影响页面的桌面和手机布局、图标加载、控制台错误、键盘焦点及登录跳转。
使用独立测试配置和虚构账号，页面截图不得包含真实凭据。测试覆盖新增行为与曾出现的故障，
避免仅为 CSS 类名或固定文案增加脆弱断言。

`pnpm build` 会构建管理台和门户，并装配到 `packages/server-core/public/`。
管理台产物由仓库跟踪，修改前端后需检查源码与装配产物一致；不要手改生成的 JS / CSS，
也不要只提交源码而遗漏本次变更对应的已跟踪产物。

## AI 技能入口

UI 开发任务使用仓库技能
[`x-oidc-ui-quality`](../../.agents/skills/x-oidc-ui-quality/SKILL.md)，
工程提交与推送边界遵循 `AGENTS.md` 和工程质量技能。
