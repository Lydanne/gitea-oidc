# Gitea OIDC Identity Provider

[中文文档](./README.md) · [English README](./README.en.md)

[![CI-CHECK](https://github.com/Lydanne/gitea-oidc/actions/workflows/ci-check.yml/badge.svg)](https://github.com/Lydanne/gitea-oidc/actions/workflows/ci-check.yml)
[![Release](https://github.com/Lydanne/gitea-oidc/actions/workflows/release.yml/badge.svg)](https://github.com/Lydanne/gitea-oidc/actions/workflows/release.yml)
[![npm version](https://img.shields.io/npm/v/gitea-oidc)](https://www.npmjs.com/package/gitea-oidc)
[![Docker pulls](https://img.shields.io/docker/pulls/lydamirror/gitea-oidc)](https://hub.docker.com/r/lydamirror/gitea-oidc)
![Node version](https://img.shields.io/badge/node-22.13.x-43853d?logo=node.js)
![License](https://img.shields.io/badge/license-MIT-blue)
[![codecov](https://codecov.io/gh/Lydanne/gitea-oidc/branch/main/graph/badge.svg)](https://codecov.io/gh/Lydanne/gitea-oidc)
[![Checked with Biome](https://img.shields.io/badge/Checked_with-Biome-60a5fa?style=flat&logo=biome)](https://biomejs.dev)

A simple and extensible **OpenID Connect Identity Provider** for Gitea and other clients,
built with **Fastify**, **TypeScript** and **oidc-provider**. It provides a plugin-based
authentication system (local password, Feishu, and extensible providers), flexible
user repositories, and pluggable OIDC persistence adapters.

> Most in-depth documents (under `docs/`) are currently written in Chinese.
> This English README gives you a compact overview and links to the main guides.

---

## Table of Contents

- [Gitea OIDC Identity Provider](#gitea-oidc-identity-provider)
  - [Table of Contents](#table-of-contents)
  - [Features](#features)
  - [Architecture Overview](#architecture-overview)
  - [Getting Started](#getting-started)
    - [Prerequisites](#prerequisites)
    - [1. Install dependencies](#1-install-dependencies)
    - [2. Create configuration](#2-create-configuration)
    - [3. Create `.htpasswd` (local auth)](#3-create-htpasswd-local-auth)
    - [4. Run the server](#4-run-the-server)
  - [Configuration Overview](#configuration-overview)
  - [Gitea Integration](#gitea-integration)
  - [Docker \& Deployment](#docker--deployment)
  - [Development \& Testing](#development--testing)
  - [Documentation](#documentation)
  - [License](#license)
  - [Team](#team)

---

## Features

- **Full OIDC flows** using [`oidc-provider`](https://github.com/panva/node-oidc-provider)
- **Plugin-based authentication system** via an `AuthCoordinator`
- **Built-in providers**:
  - Local password authentication (htpasswd format, bcrypt/MD5/SHA)
  - Feishu (Lark) OAuth 2.0 login
- **Unified login page** combining multiple providers
- **Optional application control plane** with custom applications, a versioned Gitea template,
  one-time credentials, and Client Secret rotation
- **Built-in user portal** with an authenticated application directory, admin shortcut, and
  independent BFF session
- **Private preview integration packages** for native Node.js, SQLite session storage, Express 4/5,
  Fastify 5, NestJS 10/11, and a local setup CLI (not published to npm yet)
- **Flexible user repositories**:
  - In-memory
  - SQLite
  - PostgreSQL
- **Structured identity auditing** for user/admin login, logout, and user profile changes
- **OIDC persistence adapters** via `OidcAdapterFactory`:
  - SQLite
  - Redis
  - Memory (development only)
- **State store** for OAuth state & auth results (`MemoryStateStore`)
- **Type-safe configuration** with Zod validation
- **Vitest test suite** with coverage using `@vitest/coverage-v8`

---

## Architecture Overview

At a high level:

- `packages/server-core/src/identityServer.ts`
  - Bootstraps Fastify 5
  - Loads merged configuration from `gitea-oidc.config.js/json` via
    `packages/server-core/src/config.ts`
  - Configures `oidc-provider` and mounts it at `/oidc`
  - Integrates the authentication system (unified login, OAuth state, callbacks)
- `packages/contracts/`
  - Owns versioned connection, credential, template, rotation, and management response contracts
- `packages/application-templates/`
  - Owns versioned built-in templates and immutable creation snapshots
- `packages/applications/`
  - Owns applications, OIDC Clients, encrypted/rotatable secrets, auditing, and SQLite persistence
- `packages/oidc-client/` and `packages/oidc-client-sqlite/`
  - Provide the framework-neutral OIDC relying-party core and encrypted production SQLite stores
- `packages/express/`, `packages/fastify/`, and `packages/nestjs/`
  - Adapt the shared OIDC and HTTP connector cores to supported frameworks
- `packages/cli/`
  - Validates exported connection files, diagnoses discovery, and safely initializes local projects
- `apps/idp-server/src/main.ts`
  - Owns the production process lifecycle and graceful shutdown
- `packages/server-core/src/core/AuthCoordinator.ts`
  - Manages authentication providers and their routes/webhooks/static assets
  - Renders a unified login page combining providers according to priority
- `packages/server-core/src/providers/`
  - `LocalAuthProvider`: htpasswd-based local password login
  - `FeishuAuthProvider`: Feishu OAuth 2.0 login using official Lark Node SDK
- `packages/server-core/src/repositories/`
  - `MemoryUserRepository`, `SqliteUserRepository`, `PgsqlUserRepository`
- `packages/server-core/src/adapters/`
  - `OidcAdapterFactory` + `SqliteOidcAdapter` + `RedisOidcAdapter`
- `packages/server-core/src/stores/`
  - `MemoryStateStore` for OAuth state & temporary auth results

For a more detailed design, see (Chinese):

- `docs/dev/AUTH_PLUGIN_DESIGN.md`
- `docs/dev/PLUGIN_ROUTES_GUIDE.md`
- `docs/ADAPTER_CONFIGURATION.md`

---

## Getting Started

### Prerequisites

- Node.js **22.13.x** for workspace development and builds
- pnpm **10+**

### 1. Install dependencies

```bash
pnpm install
```

### 2. Create configuration

Copy the example config and adjust it to your environment:

```bash
cp example.gitea-oidc.config.json gitea-oidc.config.json
```

Important fields (development example):

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 3000,
    "url": "http://localhost:3000"
  },
  "oidc": {
    "issuer": "http://localhost:3000/oidc",
    "cookieKeys": [
      "change-this-to-a-random-string-in-production",
      "and-another-one-for-key-rotation"
    ]
  },
  "clients": [
    {
      "client_id": "gitea",
      "client_secret": "gitea-client-secret-change-in-production",
      "redirect_uris": [
        "http://localhost:3001/user/oauth2/gitea/callback"
      ],
      "post_logout_redirect_uris": ["http://localhost:3001/"],
      "response_types": ["code"],
      "grant_types": ["authorization_code", "refresh_token"],
      "token_endpoint_auth_method": "client_secret_basic"
    }
  ]
}
```

> Note: Because the OIDC provider is mounted under `/oidc`,
> `oidc.issuer` must include `/oidc`, e.g. `https://auth.example.com/oidc`.

### 3. Create `.htpasswd` (local auth)

```bash
read -r -s ADMIN_PASSWORD
export ADMIN_PASSWORD
node -e "const bcrypt = require('bcrypt'); console.log('admin:' + bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10));" > .htpasswd
unset ADMIN_PASSWORD
chmod 0600 .htpasswd
```

### 4. Run the server

```bash
# Development (with watch)
pnpm dev

# Validate the production build
pnpm build:prod
```

The default dev URL is: `http://localhost:3000`.

`pnpm start` runs in production mode and rejects the local HTTP/memory example. Follow
`docs/PRODUCTION_SETUP.md` before starting a production deployment.

You can verify the OIDC discovery document at:

```bash
curl http://localhost:3000/oidc/.well-known/openid-configuration
```

---

## Configuration Overview

The full configuration is validated by Zod
(`packages/server-core/src/schemas/configSchema.ts`).
Key sections in `gitea-oidc.config.*`:

- `server`: host/port/public URL, reverse proxy trust
- `logging`: enable/disable and log level
- `audit`: structured identity audit switch and retention period; uses the user repository backend
- `oidc`: issuer, cookie keys, TTLs, claims & features
- `clients`: OIDC clients (e.g. Gitea)
- `applications`: optional application control plane and its single Client source
  - compatibility mode: `enabled: false`, `clientSource: "config"`
  - database mode: `enabled: true`, `clientSource: "database"`
  - database mode currently requires a 32-byte Base64/Base64URL master key and single-instance
    SQLite storage
- `auth.userRepository`:
  - `type`: `memory` | `sqlite` | `pgsql`
  - `memory`: in-memory store (dev only)
  - `sqlite`: `dbPath` path
  - `pgsql`: connection string or host-based configuration
- `auth.providers`:
  - `local`: htpasswd-based login
  - `feishu`: Feishu OAuth 2.0
- `adapter`:
  - OIDC persistence: `sqlite`, `redis`, or `memory`
- `jwks`: JWKS file path & key id

For concrete JSON examples, refer to:

- `README.md` (Chinese, detailed examples)
- `example.gitea-oidc.config.json`

---

## Gitea Integration

Basic steps for integrating this IdP with Gitea:

1. In Gitea, go to **Site Administration → Authentication Sources → Add Authentication Source**.
2. Choose **OpenID Connect**.
3. Configure:
   - **Discovery URL**: `http://localhost:3000/oidc/.well-known/openid-configuration`
   - **Client ID**: `gitea`
   - **Client Secret**: `gitea-client-secret-change-in-production`
4. Save and try logging in via OIDC.

For more detailed, step-by-step instructions (Chinese), see `docs/QUICK_START.md`.

---

## Docker & Deployment

The image starts with `NODE_ENV=production` and refuses to run without a valid production config.
Pin an explicit release version instead of `latest`:

The container runs as UID/GID `10001:10001`. Before bind-mounting files, grant that identity access
to the read-only config and secrets and ownership of the writable data directory. See the production
guide for commands that preserve restrictive secret permissions.

```bash
docker run -d --name gitea-oidc \
  -p 127.0.0.1:3000:3000 \
  -e NODE_ENV=production \
  --env-file /srv/gitea-oidc/.env.production \
  -v /srv/gitea-oidc/gitea-oidc.config.js:/app/gitea-oidc.config.js:ro \
  -v /srv/gitea-oidc/data:/app/data \
  -v /srv/gitea-oidc/secrets:/app/secrets:ro \
  lydamirror/gitea-oidc:<version>
```

See the Chinese deployment documentation for the complete, validated workflow:

- `docs/PRODUCTION_SETUP.md` – topology, configuration, Compose, HTTPS, and go-live checks
- `docs/GITEA_INTEGRATION.md` – Gitea login, logout, and claims integration
- `docs/USER_PORTAL.md` – portal Client, application directory, logout boundaries, and operations
- `docs/OPERATIONS.md` – health checks, backup, restore, upgrade, and rollback

---

## Development & Testing

Scripts (from `package.json`):

- `pnpm dev` – run in development mode with watch
- `pnpm build` / `pnpm build:prod` – build with Rolldown
- `pnpm start` – run the built server
- `pnpm test` – run Vitest tests
- `pnpm test:coverage` – run tests with V8 coverage
- `pnpm release` – drive the automated release process

GitHub Actions workflows:

- `.github/workflows/ci-check.yml` – CI for PRs (lint, test, build, Docker build)
- `.github/workflows/release.yml` – test → build → npm publish → Docker build & push

---

## Documentation

Main documentation lives under `docs/` and is currently in Chinese:

- `docs/README.md` – documentation index
- `docs/QUICK_START.md` – quick start guide
- `docs/PRODUCTION_SETUP.md` – production setup
- `docs/GITEA_INTEGRATION.md` – Gitea login, logout, and claims integration
- `docs/OPERATIONS.md` – health checks, backup, restore, upgrade, and rollback
- `docs/APPLICATION_MANAGEMENT.md` – application management, key handling, and SQLite operations
- `docs/ADAPTER_CONFIGURATION.md`, `docs/REDIS_ADAPTER_GUIDE.md` – adapter details
- `docs/REVERSE_PROXY_HTTPS.md` – reverse proxy & HTTPS
- `docs/dev/README.md` – developer documentation index
- `docs/dev/AUTH_PLUGIN_DESIGN.md` – plugin architecture
- `docs/dev/PLUGIN_ROUTES_GUIDE.md` – how to build custom providers

If you can read Chinese, please start from `docs/QUICK_START.md`.

---

## License

This project is licensed under the **MIT License**.

## Team

XGJ lydanne
