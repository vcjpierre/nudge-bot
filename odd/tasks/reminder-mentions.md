# Feature: menciones en recordatorios

## Objetivo
`/recordatorio` soporta `@número` para que el aviso etiquete a usuarios específicos con notificación de WhatsApp.

## Problema
Hoy los avisos llegan a todo el grupo sin etiquetar. La única vía es escribir el nombre a mano, sin notificación.

## Por qué
El envío (`sendToGroup`) ya acepta `mentions`, pero parser, servicio y scheduler no lo usan.

## Alcance autorizado
- Sintaxis: `@` + 8–15 dígitos con código de país, en cualquier parte del mensaje. Ej: `/recordatorio hoy 18:00 @59112345678 Sacar la basura`.
- Múltiples menciones permitidas. El `@texto` se conserva en el mensaje para que WhatsApp lo renderice.
- JID: `<dígitos>@s.whatsapp.net`.
- Solo estos archivos: `src/db/schema.ts` (+ migración), `src/reminders/parser.ts`, `src/reminders/service.ts`, `src/reminders/scheduler.ts`, `src/commands/reminder.ts`, tests.
- Sin commit (decisión del usuario).

## Checklist
- [x] T1: columna `mentions` (JSON nullable) en schema + migración `pnpm db:generate`.
- [x] T2: parser extrae `@dígitos` válidos y los devuelve junto al mensaje.
- [x] T3: service.create guarda mentions; scheduler los pasa a `sendToGroup`.
- [x] T4: command integra parser→service sin romper flujo actual.
- [x] T5: tests nuevos de extracción + suite completa verde + typecheck 0 errores.

## Criterios de aceptación
- `/recordatorio hoy 18:00 @59112345678 Hola` crea reminder con mentions `["59112345678@s.whatsapp.net"]`.
- Al dispararse, el envío incluye esos JIDs en `mentions`.
- Sin `@`, comportamiento idéntico al actual.
- `pnpm typecheck` 0 errores, `pnpm vitest run` todo verde.

## Progreso
- 2026-10-07: documento creado, implementación delegada.
- 2026-10-07: T1–T5 completos — `vitest run` 80/80 verde, `typecheck` 0 errores.
- 2026-10-07: T6 bugfix menciones LID (ver detalle abajo) — `vitest run` 97/97 verde, `typecheck` 0 errores.

## T6: bugfix — menciones no resaltan en grupos LID
- Síntoma: el aviso llegaba como `⏰ Recordatorio para Jean Pierre Velez: @1614434705868 Probando mencion` — el `@` no resaltaba y el prefijo nombraba al creador en vez del etiquetado.
- Causa: el JID mencionado se armaba como `<dígitos>@s.whatsapp.net`, pero en grupos con direccionamiento LID el participante existe como `<lid>@lid` (ver `extractGroupMetadata` en `node_modules/baileys/lib/Socket/groups.js`: `id: attrs.jid`, `jid` = PN derivado de `attrs.phone_number`, `lid` = LID). El mention con JID PN no se resalta y el formato de entrega no reflejaba a los etiquetados. (Efecto colateral detectado: T1–T5 había quitado el `#id` del reply de confirmación y dejado `tests/handler.test.ts` en rojo; se restauró.)
- Cambios:
  - `src/reminders/mentions.ts` (nuevo): `extractMentionDigits`, `stripMentionTokens`, `resolveGroupMentions` (match por JID PN exacto o teléfono→JID; devuelve el `id` REAL del participante + label `@notify` o `@dígitos`; no-miembros → `ignored`).
  - `src/commands/reminder.ts`: resuelve contra `ctx.fetchGroupMetadata()`; guarda cuerpo limpio (tokens fuera, error si queda vacío); avisa ignorados en el reply; sin metadata, fallback legacy intacto.
  - `src/reminders/service.ts`: `mentions` acepta `MentionRef[]` (JSON `{jid,label}`); `parseMentionRefs` + `mentionsHaveLabels` con lectura backward-compat del string[] legacy.
  - `src/reminders/scheduler.ts`: `buildDeliveryText` — con labels: `⏰ Recordatorio para @A, @B: <cuerpo>` y mentions en orden posicional (refs primero, creador último); sin labels: formato legacy intacto.
  - `tests/reminder-mentions.test.ts`: +17 tests (PN, LID, ignorados, strip, formato con/sin, backward-compat, comando E2E, scheduler LID).
- Criterios T6: `/recordatorio 25/12/2030 08:00 @59111111111 Sacar la basura` en grupo LID guarda cuerpo `Sacar la basura` + mentions `[{"jid":"<lid>@lid","label":"@<notify>"}]`; al disparar envía `⏰ Recordatorio para @<notify>: Sacar la basura` con `mentions=[<lid>@lid, creatorJid]`.
