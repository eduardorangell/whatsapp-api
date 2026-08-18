# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

This is a fresh Deno scaffold — three files (`main.ts`, `main_test.ts`, `deno.json`) and no dependencies beyond `@std/assert`. Despite the directory name, there is no Baileys/WhatsApp code here yet; assume any WhatsApp integration still has to be built from scratch rather than looking for existing modules.

Not a git repository — there is no history to consult and `git` commands will fail until someone runs `git init`.

## Commands

```
deno task dev          # run main.ts with --watch --allow-net
deno test              # run all tests
deno test main_test.ts --filter "returns json on /api"   # single test by name
deno check main.ts     # typecheck
deno fmt / deno lint   # built-in formatter and linter (no config; defaults apply)
```

Tests use `Deno.test` and need no network permission because they call `handler` directly rather than starting a server.

## Architecture

`main.ts` exports a single `handler(req: Request): Response` and only calls `Deno.serve` under `import.meta.main`. That split is what makes the tests permission-free and fast — keep request handling in exported, directly-callable functions and confine server startup to the `import.meta.main` block.

Routing is a manual `URL.pathname` comparison. If routes grow past a handful, that's the point to introduce a router rather than extending the if-chain.

Dependencies are declared in the `imports` map in `deno.json` (JSR/npm specifiers), not in a `package.json`. There is no lockfile checked in yet; adding one (`deno.lock`) happens automatically on the first install of a new dependency.
