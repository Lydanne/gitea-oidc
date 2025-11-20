# Gitea OIDC Identity Provider

[中文文档](./README.md) · [English README](./README.en.md)

[![CI-CHECK](https://github.com/Lydanne/gitea-oidc/actions/workflows/ci-check.yml/badge.svg)](https://github.com/Lydanne/gitea-oidc/actions/workflows/ci-check.yml)
[![Release](https://github.com/Lydanne/gitea-oidc/actions/workflows/release.yml/badge.svg)](https://github.com/Lydanne/gitea-oidc/actions/workflows/release.yml)
[![npm version](https://img.shields.io/npm/v/gitea-oidc)](https://www.npmjs.com/package/gitea-oidc)
[![Docker pulls](https://img.shields.io/docker/pulls/lydamirror/gitea-oidc)](https://hub.docker.com/r/lydamirror/gitea-oidc)
![Node version](https://img.shields.io/badge/node-%3E%3D22.0.0-43853d?logo=node.js)
![License](https://img.shields.io/badge/license-MIT-blue)
[![codecov](https://codecov.io/gh/Lydanne/gitea-oidc/branch/main/graph/badge.svg)](https://codecov.io/gh/Lydanne/gitea-oidc)

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

- `src/server.ts`
  - Bootstraps Fastify 5
  - Loads merged configuration from `gitea-oidc.config.js/json` via `src/config.ts`
  - Configures `oidc-provider` and mounts it at `/oidc`
  - Integrates the authentication system (unified login, OAuth state, callbacks)
- `src/core/AuthCoordinator.ts`
  - Manages authentication providers and their routes/webhooks/static assets
  - Renders a unified login page combining providers according to priority
- `src/providers/`
  - `LocalAuthProvider`: htpasswd-based local password login
  - `FeishuAuthProvider`: Feishu OAuth 2.0 login using official Lark Node SDK
- `src/repositories/`
  - `MemoryUserRepository`, `SqliteUserRepository`, `PgsqlUserRepository`
- `src/adapters/`
  - `OidcAdapterFactory` + `SqliteOidcAdapter` + `RedisOidcAdapter`
- `src/stores/`
  - `MemoryStateStore` for OAuth state & temporary auth results

For a more detailed design, see (Chinese):

- `docs/AUTH_PLUGIN_DESIGN.md`
- `docs/PLUGIN_ROUTES_GUIDE.md`
- `docs/ADAPTER_CONFIGURATION.md`

---

## Getting Started

### Prerequisites

- Node.js **>= 22.0.0**
- `pnpm` (recommended; `npm`/`yarn` also work with minor changes)

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
node -e "const bcrypt = require('bcrypt'); console.log('admin:' + bcrypt.hashSync('admin123', 10));" > .htpasswd
```

### 4. Run the server

```bash
# Development (with watch)
pnpm dev

# Production build
pnpm build && pnpm start
```

The default dev URL is: `http://localhost:3000`.

You can verify the OIDC discovery document at:

```bash
curl http://localhost:3000/oidc/.well-known/openid-configuration
```

---

## Configuration Overview

The full configuration is validated by Zod (`src/schemas/configSchema.ts`).
Key sections in `gitea-oidc.config.*`:

- `server`: host/port/public URL, reverse proxy trust
- `logging`: enable/disable and log level
- `oidc`: issuer, cookie keys, TTLs, claims & features
- `clients`: OIDC clients (e.g. Gitea)
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

For more detailed, step-by-step instructions (Chinese), see:

- `docs/SERVER_INTEGRATION_GUIDE.md`
- `docs/INTEGRATION_COMPLETE.md`

---

## Docker & Deployment

A simple way to run the IdP in production is via Docker:

```bash
# Pull latest image
docker pull lydamirror/gitea-oidc:latest

# Run with default ports
docker run -d -p 3000:3000 lydamirror/gitea-oidc
```

With a custom JSON config:

```bash
docker run -p 3000:3000 \
  -e NODE_ENV=production \
  -v ./gitea-oidc.config.json:/app/gitea-oidc.config.json \
  lydamirror/gitea-oidc
```

See `README.md` (Chinese) for more detailed production recommendations:

- HTTPS & reverse proxy
- SQLite / Redis adapters for persistence
- PostgreSQL/SQLite user repositories

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

- `docs/QUICK_START.md` – quick start guide
- `docs/PRODUCTION_SETUP.md` – production setup
- `docs/AUTH_PLUGIN_DESIGN.md` – plugin architecture
- `docs/PLUGIN_ROUTES_GUIDE.md` – how to build custom providers
- `docs/ADAPTER_CONFIGURATION.md`, `docs/REDIS_ADAPTER_GUIDE.md` – adapter details
- `docs/REVERSE_PROXY_HTTPS.md` – reverse proxy & HTTPS

If you can read Chinese, please start from `docs/QUICK_START.md`.

---

## License

This project is licensed under the **ISC License**.

## Team

XGJ lydanne
