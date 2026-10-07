# AGENTS.md — bot-wpp

WhatsApp group reminder bot. TypeScript ESM + Baileys, Drizzle ORM on SQLite (better-sqlite3), Hono health server, Zod-validated env.

## Commands (pnpm@10.14.0, Node >= 20)

- `pnpm install` then `cp .env.example .env` and set `BOT_OWNER_NUMBER` (digits only, 8–15 chars) — startup throws without it.
- `pnpm dev` — watch mode (tsx). `pnpm start` — run once. `pnpm build` — `tsc` to `dist/`.
- `pnpm test` — `vitest run` (all). Single file: `pnpm vitest run tests/<name>.test.ts`.
- `pnpm typecheck` — must pass both: app (`tsconfig.json`) + tests (`tsconfig.test.json`).
- DB: `pnpm db:generate` after editing `src/db/schema.ts`; `pnpm db:migrate` to apply. Migrations also auto-run on boot (`runMigrations()` in `src/index.ts`), so manual migrate is optional in dev.

## Architecture

- Entrypoint `src/index.ts`. Boot order: migrations → services → scheduler → WhatsApp → health. Shutdown reverses it. Keep that order.
- `src/commands/` — one file per command (no switch). New command = new file + one `registry.register(...)` line in `src/commands/index.ts` (`buildCommandRegistry()`).
- `src/reminders/` — parser (date-fns, no NLP), service (DB), scheduler (15s polling, atomic claim via `claimedAt`).
- `src/db/` — Drizzle schema (`src/db/schema.ts`, output `src/db/migrations/`), connection, `message-guard` (idempotency via `processed_messages`, purged after 48h).
- `src/whatsapp/` — Baileys client, parsing, permissions (`BOT_OWNER > GROUP_ADMIN > EVERYONE`), disconnect alerts.
- `src/config/env.ts` — dotenv + Zod; fails fast on bad env. Tests override via `vitest.config.ts` (`DATABASE_PATH: ':memory:'`).
- `src/health/` — Hono `GET /health` with metrics; `src/groups/` — whitelist service; `src/utils/` — pino logger, JID helpers.

## Conventions & gotchas

- ESM with `.js` import suffixes in source (e.g. `./registry.js`); `verbatimModuleSyntax` + `isolatedModules` — use `import type` for types.
- Strict TS: `noUncheckedIndexedAccess`, `noImplicitOverride`. Run `pnpm typecheck` before finishing.
- Reminders are never hard-deleted (`PENDING → EXECUTED | CANCELLED`); times stored as UTC epoch ms, interpreted in group timezone (`authorized_groups.timezone`, null = global `TIMEZONE`).
- `data/`, `auth/`, `.env` are gitignored runtime state — never commit them. No Dockerfile, no CI, no linter/formatter config.
