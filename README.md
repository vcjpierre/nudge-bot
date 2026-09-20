# bot-wpp

Bot de WhatsApp para **grupos privados** con sistema de recordatorios por comandos. Construido con TypeScript + Node.js + [Baileys](https://github.com/WhiskeySockets/Baileys), Drizzle ORM sobre SQLite, Zod, date-fns y Hono (health check).

> ⚠️ **Aviso**: Baileys es un cliente no oficial de WhatsApp. Usa un número dedicado; existe riesgo de que Meta restrinja la cuenta. El bot avisa al `BOT_OWNER` por WhatsApp si la conexión cae.

## Funcionalidad

- Escucha mensajes de grupos y responde solo a comandos que empiezan con `/`.
- Los comandos normales solo funcionan en **grupos autorizados** (whitelist en DB).
- Permisos por comando: `EVERYONE` / `GROUP_ADMIN` (admins reales del grupo) / `BOT_OWNER`.
- Recordatorios persistentes en SQLite: sobreviven reinicios, se recuperan los vencidos y nunca se envían duplicados.
- Arquitectura modular de comandos (un archivo por comando, sin `switch`).

## Requisitos

- Node.js >= 20 (desarrollado con 22)
- pnpm 10

## Instalación

```bash
pnpm install
cp .env.example .env   # edita las variables
```

## Variables de entorno

| Variable | Requerida | Descripción |
|---|---|---|
| `BOT_OWNER_NUMBER` | ✅ | Tu número con código de país, solo dígitos (ej. `59171234567`). Es quien puede autorizar grupos. |
| `BOT_OWNER_JID` | — | Override si WhatsApp te identifica con un LID. Míralo en los logs al enviar un comando (`senderJid=...@lid`). |
| `PHONE_NUMBER` | Primera ejecución | Número del bot, solo dígitos. Se usa para generar el código de vinculación. |
| `TIMEZONE` | — | Zona horaria IANA para interpretar comandos. Default `America/La_Paz`. |
| `DATABASE_PATH` | — | Ruta del SQLite. Default `./data/bot.db`. |
| `AUTH_DIR` | — | Directorio de credenciales de sesión. Default `./auth`. |
| `LOG_LEVEL` | — | `debug`/`info`/`warn`/`error`. Default `info`. |
| `PORT` | — | Puerto del health check HTTP. Default `3000`. |

## Base de datos

```bash
pnpm db:generate   # regenera SQL tras cambiar src/db/schema.ts
pnpm db:migrate    # aplica migraciones (también corren solas al arrancar)
```

Tablas: `authorized_groups` (whitelist), `reminders` (con `claimedAt` para ejecución atómica) y `processed_messages` (idempotencia contra re-entregas de WhatsApp).

## Ejecución

```bash
pnpm dev        # desarrollo con watch (tsx)
pnpm start      # ejecución directa con tsx
pnpm build      # compila a dist/
pnpm test       # vitest
pnpm typecheck  # tsc en src y tests
```

Health check: `GET http://localhost:3000/health` → `{"status":"ok","whatsapp":true|false,...}`.

## Vinculación inicial de WhatsApp

1. Configura `PHONE_NUMBER` en `.env` (número del bot, solo dígitos con código de país).
2. Arranca con `pnpm dev`.
3. En los logs aparecerá: `VINCULACIÓN ... ingresa el código XXXX-XXXX`.
4. En el WhatsApp del número del bot: **Dispositivos vinculados → Vincular con número de teléfono** e ingresa el código.
5. La sesión queda guardada en `AUTH_DIR` y persiste entre reinicios. Si cierras sesión desde WhatsApp, borra `AUTH_DIR` y repite.

## Uso

1. Agrega el número del bot al grupo.
2. Desde tu número (el `BOT_OWNER_NUMBER`), envía en el grupo: `/autorizar-grupo`.
3. Listo: todos los miembros ya pueden usar los comandos `EVERYONE`.

### Comandos

| Comando | Permiso | Descripción |
|---|---|---|
| `/recordatorio hoy 21:00 Sacar la basura` | Todos | Crea recordatorio. Formatos: `hoy`, `mañana`, `pasado mañana`, `dd/mm/aaaa` y `en N minutos/horas/días`. |
| `/recordatorios` | Todos | Lista los próximos 10 pendientes del grupo. |
| `/eliminar <id>` | Admins del grupo | Cancela un recordatorio (queda `CANCELLED`, no se borra). |
| `/config zona <IANA\|reset>` | Admins del grupo | Zona horaria propia del grupo (ej: `America/Buenos_Aires`). |
| `/ayuda` | Todos | Comandos que puedes usar, agrupados por categoría. |
| `/mijid` | Todos | Muestra tu JID (para configurar `BOT_OWNER_JID` si WhatsApp te da LID). |
| `/autorizar-grupo` | Solo owner | Autoriza el grupo actual (guarda JID y nombre). |
| `/desautorizar-grupo` | Solo owner | Deshabilita el grupo. |

Cuando llega la hora, el bot envía: `⏰ Recordatorio para <nombre>: <mensaje>` (con mención al creador). Los comandos que modifican estado confirman con reacción ✅ (o ❌ si hay error de formato).

## Arquitectura

```
src/
├── commands/      # registry + handler + rate-limiter; un archivo por comando
├── whatsapp/      # client (Baileys), messages (parseo), permissions, disconnect-alerts
├── reminders/     # parser (fecha/hora), service (DB), scheduler (polling + claim atómico)
├── groups/        # servicio de grupos autorizados
├── db/            # schema Drizzle, conexión, migraciones, message-guard
├── config/        # env validado con Zod
├── health/        # servidor Hono (/health)
└── utils/         # logger (pino), helpers de JID
```

**Scheduler**: polling cada 15 s de `PENDING` vencidos. Cada ejecución hace *claim* atómico en SQLite (`UPDATE ... WHERE status='PENDING' RETURNING`), de modo que reinicios y (a futuro) múltiples instancias no duplican envíos. Si el envío falla, se programa un reintento con **backoff exponencial persistido** (`attempts`/`nextRetryAt`: 1min, 2min, 4min… hasta 1h); un claim abandonado expira a los 5 min.

**Watchdog de conexión**: si el socket queda "abierto" pero sin actividad durante 5 minutos (socket zombi, caso conocido de Baileys), se fuerza la reconexión automáticamente.

**Configuración por grupo**: `/config zona <IANA>` permite que cada grupo tenga su propia zona horaria (columna `timezone` en `authorized_groups`; `null` = global). Es el patrón de extensión para futuras opciones por grupo.

**Permisos**: `BOT_OWNER` > `GROUP_ADMIN` > `EVERYONE`. Los admins se detectan con la metadata real del grupo (incluye soporte para JIDs `@lid`). Un admin de WhatsApp **no** puede autorizar grupos.

**Seguridad**: whitelist de grupos, rate limit (10 comandos/min/usuario, 30/min/grupo), validación Zod, límite de longitud, idempotencia por `messageId`, mensajes privados ignorados, secretos solo por variables de entorno.

## Decisiones documentadas

- **Sin Docker** en esta versión (a pedido); el estado vive en `./data` y `./auth`, fácil de montar como volúmenes después.
- **Hono** se incluye con `/health` que expone métricas (`pendingReminders`, `authorizedGroups`, `commandsProcessed`, `commandsFailed`) — base del futuro panel web.
- **Parser de fechas propio** (date-fns + date-fns-tz) en vez de NLP, por precisión y cero dependencias pesadas.
- Fechas/horas se interpretan en la zona horaria del grupo (o la global `TIMEZONE`) y se guardan en UTC (epoch ms).
- Si "hoy HH:mm" ya pasó → error explícito con la hora actual, nunca se asume el día siguiente en silencio.

## Preparado para crecer

Agregar `/lista`, `/gasto`, `/encuesta`, etc. = crear un archivo en `src/commands/` y una línea en `buildCommandRegistry()`. Las migraciones de Drizzle cubren nuevas tablas; `TIMEZONE` por grupo, recurrencia o PostgreSQL son extensiones sin rediseño.

