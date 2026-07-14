# 文档目录

本目录面向使用者、部署者和运维人员。首次使用按“快速开始”验证本地流程；准备上线时按“生产
部署 → Gitea 接入 → 生产运维”的顺序执行。开发、维护和发布文档位于 `docs/dev/`。

## 入门与接入

- [快速开始指南](./QUICK_START.md)：本地启动、管理员登录和本地 Gitea 验证。
- [Gitea 接入指南](./GITEA_INTEGRATION.md)：应用创建、认证源、登录退出和组映射。
- [Server 使用指南](./SERVER_USAGE.md)：独立进程和模块化启动方式。

## 生产上线

- [生产部署指南](./PRODUCTION_SETUP.md)：拓扑选择、密钥、配置、Docker Compose 和上线验收。
- [反向代理 HTTPS 配置指南](./REVERSE_PROXY_HTTPS.md)：Nginx、Traefik、Caddy 和代理信任边界。
- [生产运维手册](./OPERATIONS.md)：健康检查、备份恢复、升级回滚、监控和密钥轮换。
- [OIDC 适配器配置指南](./ADAPTER_CONFIGURATION.md)：SQLite、Redis 和 memory 的选择边界。
- [Redis OIDC 适配器使用指南](./REDIS_ADAPTER_GUIDE.md)：多实例 Redis 参数与运维注意事项。

## 功能配置

- [管理后台与 Provider API 接入指南](./ADMIN_AND_PROVIDER_API.md)
- [应用管理接入指南](./APPLICATION_MANAGEMENT.md)
- [飞书认证插件使用指南](./FEISHU_PLUGIN_GUIDE.md)
- [确定性用户 ID 生成](./HASH_ID_GENERATION.md)

## 参考资料

- [OIDC-Provider 使用指南](./OIDC_HELP.md)
- [开发者文档目录](./dev/README.md)
