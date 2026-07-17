# X OIDC Identity Provider

[中文文档](./README.md) · [English README](./README.en.md)

[![CI-CHECK](https://github.com/Lydanne/gitea-oidc/actions/workflows/ci-check.yml/badge.svg)](https://github.com/Lydanne/gitea-oidc/actions/workflows/ci-check.yml)
[![Release](https://github.com/Lydanne/gitea-oidc/actions/workflows/release.yml/badge.svg)](https://github.com/Lydanne/gitea-oidc/actions/workflows/release.yml)
[![npm version](https://img.shields.io/npm/v/%40x-oidc%2Fserver-core)](https://www.npmjs.com/package/@x-oidc/server-core)
[![Docker pulls](https://img.shields.io/docker/pulls/lydamirror/x-oidc)](https://hub.docker.com/r/lydamirror/x-oidc)
![Node version](https://img.shields.io/badge/node-%3E%3D22.0.0-43853d?logo=node.js)
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

- [X OIDC Identity Provider](#x-oidc-identity-provider)
  - [Table of Contents](#table-of-contents)
  - [Features](#features)
  - [Architecture Overview](#architecture-overview)
  - [Getting Started](#getting-started)
    - [Prerequisites](#prerequisites)
    - [1. Create a consumer project](#1-create-a-consumer-project)
    - [2. Create a local development account](#2-create-a-local-development-account)
    - [3. Create and run the server entry](#3-create-and-run-the-server-entry)
    - [4. Verify discovery](#4-verify-discovery)
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
  - Loads merged configuration from `x-oidc.config.js/json` via
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

- Node.js **>= 22.0.0**
- npm (included with Node.js)

These steps use only public files in the npm tarball. They do not require a repository checkout,
repository example files, or workspace scripts.

### 1. Create a consumer project

```bash
mkdir x-oidc-server
cd x-oidc-server
npm init -y
npm pkg set type=module
npm install @x-oidc/server-core bcrypt
```

`bcrypt` is installed directly only to generate the password hash for this local development
account.

### 2. Create a local development account

```bash
read -r -s ADMIN_PASSWORD
export ADMIN_PASSWORD
node --input-type=module -e 'import bcrypt from "bcrypt"; console.log(`admin:${bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10)}`);' > .htpasswd
unset ADMIN_PASSWORD
chmod 0600 .htpasswd
```

### 3. Create and run the server entry

Create `server.mjs`:

```javascript
import { runIdentityServerProcess } from "@x-oidc/server-core";

await runIdentityServerProcess();
```

Start with the built-in local development configuration:

```bash
NODE_ENV=development node server.mjs
```

### 4. Verify discovery

```bash
curl http://localhost:3000/oidc/.well-known/openid-configuration
```

The built-in configuration is for local evaluation only. It uses HTTP, memory user storage, and
development secrets and must not be deployed as-is. Before production, create
`x-oidc.config.js` or `x-oidc.config.json` in the consumer project and follow the
[production guide](https://github.com/Lydanne/gitea-oidc/blob/main/docs/PRODUCTION_SETUP.md) for
HTTPS, persistent storage, JWKS, strong secrets, and registered OIDC Clients. See the
[server usage guide](https://github.com/Lydanne/gitea-oidc/blob/main/docs/SERVER_USAGE.md) for
programmatic configuration and custom Fastify lifecycle management.

---

## Configuration Overview

The full configuration is validated by Zod
(`packages/server-core/src/schemas/configSchema.ts`).
Key sections in `x-oidc.config.*`:

- `server`: host/port/public URL, reverse proxy trust
- `logging`: enable/disable and log level
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
- `example.x-oidc.config.json`

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

The image always starts with `NODE_ENV=production` and refuses to boot without a valid production
configuration. Pin an exact version, mount configuration and secrets read-only, and provide a
writable data directory owned by UID/GID `10001:10001`.

```bash
docker pull lydamirror/x-oidc:<version>
docker run -d --name x-oidc \
  -p 127.0.0.1:3000:3000 \
  -e NODE_ENV=production \
  --env-file /srv/x-oidc/.env.production \
  -v /srv/x-oidc/x-oidc.config.js:/app/x-oidc.config.js:ro \
  -v /srv/x-oidc/data:/app/data \
  -v /srv/x-oidc/secrets:/app/secrets:ro \
  --restart unless-stopped \
  lydamirror/x-oidc:<version>
```

See the
[production guide](https://github.com/Lydanne/gitea-oidc/blob/main/docs/PRODUCTION_SETUP.md) for
directory permissions, complete configuration, Compose, HTTPS proxying, and acceptance checks.

---

## Development & Testing

Repository development commands and CI workflows are not included in the npm tarball. Contributors
should clone the repository and follow the
[development workflow](https://github.com/Lydanne/gitea-oidc/blob/main/docs/dev/DEVELOPMENT_WORKFLOW.md).

---

## Documentation

Main documentation lives under `docs/` and is currently in Chinese:

- `docs/README.md` – documentation index
- `docs/QUICK_START.md` – quick start guide
- `docs/PRODUCTION_SETUP.md` – production setup
- `docs/USER_PORTAL.md` – portal Client, application directory, logout boundaries, and operations
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
