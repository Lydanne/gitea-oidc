# Changelog

## [1.0.18](https://github.com/Lydanne/gitea-oidc/compare/v1.0.17...v1.0.18) (2025-11-18)


### Features

* 添加 JWKS 配置支持，允许自定义密钥文件路径和密钥 ID ([17f0062](https://github.com/Lydanne/gitea-oidc/commit/17f00623d6ff44c2797fdd1dabd8100e89130caa))

## [1.0.17](https://github.com/Lydanne/gitea-oidc/compare/v1.0.16...v1.0.17) (2025-11-18)


### Bug Fixes

* 修复https的问题 ([40fea62](https://github.com/Lydanne/gitea-oidc/commit/40fea62130d0d50a50a0a9c471baafc165fd3548))

## [1.0.16](https://github.com/Lydanne/gitea-oidc/compare/v1.0.14...v1.0.16) (2025-11-18)

## [1.0.14](https://github.com/Lydanne/gitea-oidc/compare/v1.0.13...v1.0.14) (2025-11-18)

## [1.0.13](https://github.com/Lydanne/gitea-oidc/compare/v1.0.12...v1.0.13) (2025-11-18)

## [1.0.12](https://github.com/Lydanne/gitea-oidc/compare/v1.0.11...v1.0.12) (2025-11-17)


### Features

* 添加确定性用户 ID 生成文档和实现 ([d3e0062](https://github.com/Lydanne/gitea-oidc/commit/d3e0062bdf514e3793bed38f89c44a2e524b9ec2))

## [1.0.11](https://github.com/Lydanne/gitea-oidc/compare/v1.0.10...v1.0.11) (2025-11-17)


### Features

* 添加 PostgreSQL 用户仓储支持 ([12bf733](https://github.com/Lydanne/gitea-oidc/commit/12bf733d08f4d3ce7807079b43483031a5e963c1))

## [1.0.10](https://github.com/Lydanne/gitea-oidc/compare/v1.0.9...v1.0.10) (2025-11-13)

## [1.0.9](https://github.com/Lydanne/gitea-oidc/compare/v1.0.8...v1.0.9) (2025-11-13)

## [1.0.8](https://github.com/Lydanne/gitea-oidc/compare/v1.0.7...v1.0.8) (2025-11-13)

## [1.0.7](https://github.com/Lydanne/gitea-oidc/compare/v1.0.6...v1.0.7) (2025-11-13)

## [1.0.6](https://github.com/Lydanne/gitea-oidc/compare/v1.0.5...v1.0.6) (2025-11-13)

## [1.0.5](https://github.com/Lydanne/gitea-oidc/compare/v1.0.4...v1.0.5) (2025-11-13)

## [1.0.4](https://github.com/Lydanne/gitea-oidc/compare/v1.0.3...v1.0.4) (2025-11-13)

## [1.0.3](https://github.com/Lydanne/gitea-oidc/compare/v1.0.2...v1.0.3) (2025-11-13)

## 1.0.2 (2025-11-13)


### Bug Fixes

* 修复 GitHub Actions 工作流中的条件表达式语法 ([a84916d](https://github.com/Lydanne/gitea-oidc/commit/a84916d683664c8927a18bc5fb20c3c20e34e540))
* 修复 GitHub Actions 工作流中的空指针错误 ([8470c1b](https://github.com/Lydanne/gitea-oidc/commit/8470c1b063097764493c095b82f077285840bfb5))
* 修复 release-it 配置中 latestTag 为 null 时的判断逻辑 ([5720c96](https://github.com/Lydanne/gitea-oidc/commit/5720c969bd044799bb8525eb1b4f0ccbaa2dde8f))
* 修复错误 ([86cb0eb](https://github.com/Lydanne/gitea-oidc/commit/86cb0eb4f83a7771e377a26c5017722353b93c17))
* 修复飞书用户令牌交换接口调用 ([121224d](https://github.com/Lydanne/gitea-oidc/commit/121224dd034b9b84737b2b0a01d248d62c0b2848))
* 修正用户验证状态字段的空值处理逻辑 ([8665d97](https://github.com/Lydanne/gitea-oidc/commit/8665d9786a713f3bfd5c5fdfc4311ffaf73642c2))
* 修正飞书用户完整信息的数据结构解析 ([ad8a531](https://github.com/Lydanne/gitea-oidc/commit/ad8a531ae67859ea94f6a67ddff80d9b4a1a4ac5))
* 将 better-sqlite3 重建命令从 pnpm 改为 npm ([a900960](https://github.com/Lydanne/gitea-oidc/commit/a900960abe4e0e5d6d797f69a470bcfee351e00a))
* 移除 GitHub release 配置中的尾随逗号 ([45fba85](https://github.com/Lydanne/gitea-oidc/commit/45fba852773427909c6c621dbfb1101c14426853))


### Features

* sqlite state ([834c953](https://github.com/Lydanne/gitea-oidc/commit/834c9531c12860ee3b21324a198a44c20e0993ff))
* 为交互页面添加会话过期友好错误提示 ([32169ed](https://github.com/Lydanne/gitea-oidc/commit/32169edcca2d96a3f0870322e1d86957ad0721fc))
* 优化 OAuth 回调流程以解决 cookie 丢失问题 ([2aa9cda](https://github.com/Lydanne/gitea-oidc/commit/2aa9cdab5e0b9b7b877e694fb9f11a103f5a331d))
* 升级版本至 1.0.1 ([87f2054](https://github.com/Lydanne/gitea-oidc/commit/87f2054dd792a4cc6fe07c4af4aca69db0c6aa7a))
* 完善飞书插件权限配置文档 ([acf1a46](https://github.com/Lydanne/gitea-oidc/commit/acf1a467441136d0fa6e95a021b994a5c3437dd8))
* 将构建工具从 tsc 迁移到 rolldown ([48198e3](https://github.com/Lydanne/gitea-oidc/commit/48198e38af3671c7c87a98788d57e245563d6ade))
* 支持 sqlite repo ([8ae29d3](https://github.com/Lydanne/gitea-oidc/commit/8ae29d3d00ecddcf0fd2f7c8c51d167e4c2db414))
* 支持飞书加密回调和事件订阅验证 ([35b587b](https://github.com/Lydanne/gitea-oidc/commit/35b587b68b14e71c5a17c275669525dc9bfc939a))
* 添加 Gitea 服务器 Docker Compose 配置 ([264cd1c](https://github.com/Lydanne/gitea-oidc/commit/264cd1cbbb1054079aac05d5201cf10c32bddad3))
* 添加表单数据解析支持和新用户 ([88419da](https://github.com/Lydanne/gitea-oidc/commit/88419da43778cad5f27bff6f61a0bd6ddc11a030))
* 添加认证插件系统设计文档和基础配置 ([d93dbc1](https://github.com/Lydanne/gitea-oidc/commit/d93dbc199ab66834831eeb0a6eceeb70c04c9a86))
* 添加项目首页展示功能 ([9c8ca0b](https://github.com/Lydanne/gitea-oidc/commit/9c8ca0bbc366450471e994a52b6ac17f4cd6aac9))
* 添加飞书组到 Gitea 组的映射配置 ([98288aa](https://github.com/Lydanne/gitea-oidc/commit/98288aacc773d4bc1812021fe0ac04d34ab9671d))
* 移除 docker-compose 版本声明以使用现代格式 ([04edfd6](https://github.com/Lydanne/gitea-oidc/commit/04edfd669655dfa5c5fed51f045c916ad7eb5d96))
