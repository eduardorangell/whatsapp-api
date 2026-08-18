# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project

Rewrite of the sibling project `../whatsapp-api` (send WhatsApp text, images and
files over HTTP) on **pure Deno — no Node.js, no headless Chrome**, using
Baileys instead of WPPConnect.

```
src/env.ts       config from env vars
src/auth-kv.ts   session stored in Deno KV (replaces useMultiFileAuthState)
src/wa.ts        one socket + send helpers; pure helpers exported for tests
src/server.ts    Deno.serve + a route table
```

**No Hono, no zod, deliberately.** Eight routes with flat payloads do not need a
router or a schema library — `Deno.serve` plus a `Record<"METHOD /path", fn>`
lookup covers it. Reach for Hono when you need real middleware chains (auth,
CORS, compression) or path params; reach for zod when payloads gain nesting or
arrays.

## Commands

```
deno task dev      # server + QR in terminal, --watch
deno task start
deno task test     # 14 tests, no phone pairing needed
deno task check    # fmt --check + lint + typecheck
docker compose up  # QR appears in the compose logs
```

## Routes

`GET /`, `GET /status`, `POST /iniciar` (`{phone?}` → pairing code, else QR),
`POST /fechar`, `POST /numero-valido`, `POST /enviar-mensagem`,
`POST /enviar-imagem`, `POST /enviar-arquivo`.

`enviarTudo()` from the old project was a one-off and is intentionally absent.
If bulk sending returns, it needs the 30–45s random delay the original had —
sending without it gets numbers banned.

## Hard constraints (verified, do not re-litigate)

**Baileys 6.x cannot work in Deno.** It declares `libsignal` as a `git+https://`
dependency and Deno refuses non-npm dependencies outright. Only 7.x installs
(`npm:baileys@7.0.0-rc14`) — it moved signal crypto to `whatsapp-rust-bridge`,
which is **WebAssembly, not a native addon**. Do not "downgrade to stable 6.x"
to fix a bug; it will not install.

**Never build a JID by string concatenation.** `numeroValido()` calls
`sock.onWhatsApp()` and uses the JID WhatsApp returns. That is what handles the
Brazilian mobile 9th-digit problem; the old project's `${digits}@c.us` did not.

**Baileys media wants a Node `Buffer`**, not `Uint8Array` — hence
`Buffer.from(...)` in the send helpers. An http(s) URL passes through as
`{ url }` and Baileys downloads it itself.

**`sharp`/`jimp` are optional** — loaded via `import(...).catch(() => {})` for
thumbnails. `sharp` is a native addon and may fail to load; that is non-fatal.
Never make it a hard dependency.

**`pino` calls `os.hostname()` at import time**, so `--allow-sys` is required.

**New creds must be written to KV immediately** (`useKvAuthState` does this).
Baileys only emits `creds.update` once pairing advances, so relying on that
event alone means a restart during the QR window regenerates the identity and
invalidates the QR already on screen.

**Deno KV: the default path needs no `--allow-write`; an explicit path does.**
`KV_PATH` is unset in local dev (writeless) and set to `/data/kv.sqlite3` in
Docker, where `--allow-write=/data` is scoped to just that volume. KV also
creates `-wal`/`-shm` siblings, so the volume must be the directory.

## Testing

Routes validate method, path and payload **before** touching the connection, so
`rota()` is callable from tests with no paired phone. Keep that ordering — it is
why `src/server_test.ts` needs no mocks.

## Deployment

Deno Deploy is **not** viable and this is architectural. Baileys holds one
long-lived WebSocket carrying ratcheting Signal state; Deploy evicts idle
isolates (5s–10min) and may run several regional instances, and two instances
sharing one set of credentials trigger a WhatsApp session conflict. Use an
always-on host (VPS/Fly/Railway) — the container is ~104 MB RSS.

## Style

Portuguese for user-facing strings, route names and identifiers in `src/`
(matching `../whatsapp-api`).
