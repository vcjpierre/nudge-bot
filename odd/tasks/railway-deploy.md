# Feature: deploy en Railway

## Objetivo
Correr nudge-bot 24/7 en Railway con disco persistente para sesión Baileys + SQLite.

## Problema
Railway tiene filesystem efímero. Sin volumen, cada redeploy borra `./auth` (re-vincular QR) y `./data/bot.db` (recordatorios). Además no hay `Dockerfile` y `tsc` no copia las migraciones SQL a `dist/`, así que `node dist/index.js` fallaría en `runMigrations()`.

## Por qué
Baileys exige WebSocket siempre abierto + `AUTH_DIR` persistente. SQLite (`better-sqlite3`) exige archivo persistente. Scheduler cada 15s + watchdog + `SIGTERM` ya están listos para PaaS.

## Alcance autorizado
- Solo: `Dockerfile`, `railway.json`, `.dockerignore`, este documento. Sin tocar lógica del bot.
- Si hace falta, ajuste mínimo a `package.json` build para copiar migraciones (preferir solo Dockerfile si alcanza).
- Sin commit automático (decisión del usuario). Branch si estoy en main.
- Env en dashboard Railway (no commitear secretos): `DATABASE_PATH=/data/bot.db`, `AUTH_DIR=/data/auth`.

## Checklist
- [x] T1: `Dockerfile` prod Node 22 + pnpm 10.14.0 + build tools better-sqlite3 + `node dist/index.js` + copia `src/db/migrations` a `dist/db/migrations`.
- [x] T2: `railway.json` builder DOCKERFILE, `numReplicas: 1`, `healthcheckPath: /health`, `restartPolicyType: ON_FAILURE`, `sleepApplication: false`.
- [x] T3: `.dockerignore` (node_modules, dist, data, auth, .env, git).
- [x] T4: verificación `pnpm typecheck` + `pnpm build` + `pnpm test` verde, y `dist/db/migrations` existe vía Docker COPY (no romper local).

## Criterios de aceptación
- `Dockerfile` buildea y arranca con `PORT` inyectado por Railway, `/health` responde 200.
- Con volumen en `/data` + `DATABASE_PATH=/data/bot.db` + `AUTH_DIR=/data/auth`, un redeploy no pide re-vincular ni pierde reminders.
- Una sola réplica. `pnpm typecheck` 0 errores.
- Mirror Engram: pendiente (sin MCP en este runtime, solo archivo local).

## Progreso
- 2026-10-08: documento creado.
- 2026-10-08: T1–T4 completos — `pnpm typecheck` 0 errores, `pnpm build` ok, `pnpm test` 97/97 verde. Branch `feat/railway-deploy`, commit `9f7a072`. Falta: crear volumen + deploy en dashboard Railway.
