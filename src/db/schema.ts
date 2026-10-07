import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Grupos de WhatsApp autorizados a usar el bot.
 * `enabled = false` equivale a desautorizado (soft-delete, conserva historial).
 */
export const authorizedGroups = sqliteTable(
  'authorized_groups',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jid: text('jid').notNull(),
    name: text('name').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    /** Zona horaria IANA del grupo (null = usa TIMEZONE global). */
    timezone: text('timezone'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [uniqueIndex('authorized_groups_jid_unique').on(t.jid)],
);

export type AuthorizedGroup = typeof authorizedGroups.$inferSelect;

/**
 * Recordatorios programados.
 * Estados: PENDING -> EXECUTED | CANCELLED (nunca se borran físicamente).
 * `claimedAt` marca que una instancia del scheduler tomó el recordatorio para
 * ejecutarlo: evita envíos duplicados ante reinicios o múltiples instancias.
 */
export const reminders = sqliteTable(
  'reminders',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    groupJid: text('group_jid').notNull(),
    creatorJid: text('creator_jid').notNull(),
    creatorName: text('creator_name'),
    message: text('message').notNull(),
    /** Mentioned user JIDs (`<digits>@s.whatsapp.net`) as a JSON array, null when none. */
    mentions: text('mentions'),
    scheduledAt: integer('scheduled_at', { mode: 'timestamp_ms' }).notNull(),
    status: text('status', { enum: ['PENDING', 'EXECUTED', 'CANCELLED'] })
      .notNull()
      .default('PENDING'),
    claimedAt: integer('claimed_at', { mode: 'timestamp_ms' }),
    /** Reintentos fallidos de envío (backoff exponencial persistido). */
    attempts: integer('attempts').notNull().default(0),
    /** Próximo reintento permitido tras un fallo (null = sin restricción). */
    nextRetryAt: integer('next_retry_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    executedAt: integer('executed_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('reminders_pending_scheduled_idx').on(t.status, t.scheduledAt),
    index('reminders_group_status_idx').on(t.groupJid, t.status),
  ],
);

export type Reminder = typeof reminders.$inferSelect;

/**
 * Guardia de idempotencia: IDs de mensajes ya procesados.
 * WhatsApp puede re-entregar mensajes; la PK evita ejecutar un comando dos veces.
 * Las filas se purgan pasadas 48 h.
 */
export const processedMessages = sqliteTable('processed_messages', {
  messageId: text('message_id').primaryKey(),
  processedAt: integer('processed_at', { mode: 'timestamp_ms' }).notNull(),
});
