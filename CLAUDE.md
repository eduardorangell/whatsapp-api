# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project state

Feasibility spike, not a product yet. The goal is to rebuild the sibling project
at `../whatsapp-api` (send text/images over WhatsApp) on **pure Deno with no
Node.js and no headless Chrome**, using Baileys instead of WPPConnect.

`spike.ts` + `auth-kv.ts` are the proof that this works. There is no HTTP API
here yet — that is the next step, and `../whatsapp-api/src/server.ts` (Hono +
zod) is the template to port.

## Commands

```
deno task spike    # connect to WhatsApp, print QR in terminal
deno task check    # fmt --check + lint + typecheck
```

`spike.ts` deliberately runs without `--allow-write`, `--allow-run`, or
`--allow-ffi` to prove no filesystem or subprocess dependency.

## Hard constraints (verified, do not re-litigate)

**Baileys 6.x cannot work in Deno.** It declares `libsignal` as a `git+https://`
dependency and Deno refuses non-npm dependencies outright. Only the 7.x line
(`npm:baileys@7.0.0-rc14`, dist-tag `latest`) installs — it moved signal crypto
to `whatsapp-rust-bridge`, which is **WebAssembly, not a native addon**, so it
stays portable. Do not "downgrade to stable 6.x" to fix a bug; it will not
install.

**Auth state must never touch the filesystem.** `useKvAuthState` in `auth-kv.ts`
replaces Baileys' `useMultiFileAuthState` with Deno KV. Keep it that way — it is
what makes the process relocatable.

**`sharp` and `jimp` are optional.** Baileys loads them via
`import(...).catch(() => {})` for thumbnails only. `sharp` is a native addon and
will fail to load on restricted hosts; that is expected and non-fatal. Never add
`sharp` as a hard dependency.

**`pino` calls `os.hostname()` at import time**, so `--allow-sys` is required
even though nothing else needs it.

## Deployment

Deno Deploy is **not** a viable target and this is architectural, not a bug to
work around. Baileys holds one long-lived outbound WebSocket carrying ratcheting
Signal session state; Deno Deploy evicts idle isolates (5s–10min) and may run
several regional instances, and two instances sharing one set of credentials
trigger a WhatsApp session conflict. The connection process needs an always-on
host (VPS/Fly/Railway). An HTTP layer _in front_ of it can live on Deploy.

## Style

Portuguese for user-facing strings and API route names (matching
`../whatsapp-api`); English for code identifiers.
