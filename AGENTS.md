# AGENTS.md

This file provides guidance to AI coding assistants and agents when working with
code in this repository.

## Project Overview

Dual-engine WhatsApp HTTP API written in **pure Deno** (no heavy frameworks like
Hono or Express, no zod), allowing dynamic switching between two WhatsApp
engines:

1. **Baileys (`WA_ENGINE=baileys`, padrão)**:
   - Ultra-lightweight (~104 MB RSS) WebSocket connection talking directly to
     WhatsApp Web servers using Signal protocol cryptography in WebAssembly
     (`whatsapp-rust-bridge`).
   - Session credentials persist 100% inside **Deno KV** (`src/auth-kv.ts`),
     requiring no disk token files.
2. **WPPConnect (`WA_ENGINE=wppconnect`)**:
   - Headless Google Chrome / Chromium automation via Puppeteer.
   - Profile and authentication tokens stored in `./data/tokens`
     (`WPP_TOKENS_DIR`).

```
src/env.ts              configuration loaded from environment variables
src/auth-kv.ts          Baileys session state stored in Deno KV
src/leads.ts            lead lifecycle & anti-spam cooldown stored in Deno KV
src/obs.ts              structured JSON logging + runtime metrics counters
src/util.ts             shared utilities (normalization, spintax, delays, file types)
src/engines/types.ts    WhatsAppEngine interface & common types
src/engines/baileys.ts   Baileys implementation of WhatsAppEngine
src/engines/wppconnect.ts WPPConnect implementation of WhatsAppEngine
src/engines/factory.ts  dynamic lazy-loading engine factory
src/wa.ts               facade & compatibility adapter delegating to active engine
src/server.ts           pure Deno.serve + route table lookup
scripts/build_docker.ts modular Docker image build CLI script
```

See `README.md` for end-user documentation (routes, curl examples, Docker
setup).

**No Hono, no zod, deliberately.** Routes with flat payloads do not need a
router or external schema validator — `Deno.serve` plus a
`Record<"METHOD /path", handler>` lookup handles everything with zero overhead.

## Commands

```bash
# Development & Testing
deno task dev                    # runs with Baileys (default) with --watch
WA_ENGINE=wppconnect deno task dev # runs with WPPConnect
deno task start                  # production run without --watch
deno task test                   # 34 tests, no phone pairing needed
deno task check                  # fmt --check + lint + typecheck

# Docker Modular Builds
deno task build:docker --baileys    # builds Dockerfile.baileys (whatsapp-api:baileys)
deno task build:docker --wppconnect # builds Dockerfile.wppconnect (whatsapp-api:wppconnect)
docker compose up                # launches container with configured WA_ENGINE
```

## Routes

`GET /`, `GET /status`, `POST /iniciar` (`{phone?}` → pairing code, else QR),
`POST /fechar`, `POST /logout`, `POST /numero-valido`, `POST /enviar-mensagem`,
`POST /enviar-imagem`, `POST /enviar-arquivo`, `POST /enviar-tudo`,
`GET /leads`, `GET /leads/resumo`, `GET /leads/exportar`.

`POST /enviar-tudo` (`{numeros, texto, imagem?, diasCooldown?}`) performs
asynchronous batch sending in the background with a 30–45s random delay between
messages to protect numbers against bans.

## Hard Constraints & Architecture Rules

1. **Baileys 7.x required (`npm:baileys@7.0.0-rc14`)**: Baileys 6.x declares
   `libsignal` as a `git+https://` dependency and Deno refuses non-npm
   dependencies outright. 7.x moved signal crypto to `whatsapp-rust-bridge`
   (WASM, not a native C++ addon). Never downgrade to 6.x.
2. **Dynamic Lazy-loading in Factory**: `src/engines/factory.ts` dynamically
   imports the engine implementation (`await import("./baileys.ts")` vs
   `await import("./wppconnect.ts")`). When running Baileys, Puppeteer and
   Chromium modules are never loaded into memory.
3. **Never build a JID by string concatenation**: `numeroValido()` queries the
   WhatsApp servers (`sock.onWhatsApp()` in Baileys,
   `client.checkNumberStatus()` in WPPConnect) and uses the exact JID returned.
   That solves the Brazilian mobile 9th-digit ambiguity.
4. **WPPConnect Chromium flags**: In containerized environments, Chromium
   requires `--disable-dev-shm-usage`, `--no-sandbox`,
   `--disable-setuid-sandbox` and `--disable-gpu`. Docker compose allocates
   `shm_size: '2gb'`.
5. **WPPConnect API deprecations**: Always use
   `client.sendFile(to, content, options)` with an options object
   (`{ filename, caption }`). Do not use deprecated positional
   `sendFile(to, file, filename, caption)` or `sendImageFromBase64`.
6. **Permissions**:
   - Baileys uses `--allow-write=/data,/tmp` (KV sqlite + temp files) and
     `--allow-ffi` (sharp bindings).
   - WPPConnect additionally requires `--allow-run` to spawn Google Chrome as a
     child process.
7. **Observability**:
   - One JSON line per event on stdout via `log()` in `src/obs.ts`.
   - **Never log request payloads** containing message text or base64 files.
   - `rota()` stays pure and untangled; `comObservabilidade()` wraps it for
     `Deno.serve`.
   - `contadores.erros` counts 5xx only — a 4xx is a client error, not a service
     outage.
8. **Testing**: Routes validate method, path, and payload **before** checking
   WhatsApp connection state, enabling pure, mock-free HTTP route testing in
   `src/server_test.ts`.

## Deployment

Deno Deploy is **not** viable due to architectural constraints: both engines
maintain persistent connections (WebSocket Signal state or Chrome DevTools
Protocol socket). Deno Deploy evicts idle isolates and runs distributed regional
instances which triggers WhatsApp session conflicts. Always use an always-on
host (VPS, Docker Swarm, Fly, Railway).

## Commits

Commits must be GPG-signed as `Eduardo Rangell <rangellferreira@gmail.com>` (key
`D7670409DFEE182E`). The identity is configured in this repository's local git
config. Use `git commit -S -m "..."`.

## Style

Portuguese for user-facing strings, route names, and domain identifiers in
`src/` (matching project conventions).
