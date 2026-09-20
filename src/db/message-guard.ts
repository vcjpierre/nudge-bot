import { lt, sql } from 'drizzle-orm';
import { db } from './index.js';
import { processedMessages } from './schema.js';

const RETENTION_MS = 48 * 60 * 60 * 1000; // 48 h
const MAX_ROWS = 10_000; // techo de tamaño además del de tiempo

/**
 * Marca un mensaje como procesado de forma atómica.
 * Devuelve true si es la primera vez que se ve (hay que procesarlo),
 * false si es una re-entrega de WhatsApp (hay que ignorarlo).
 */
export function tryMarkMessageProcessed(messageId: string): boolean {
  const result = db
    .insert(processedMessages)
    .values({ messageId, processedAt: new Date() })
    .onConflictDoNothing()
    .run();
  return result.changes > 0;
}

/**
 * Elimina registros con más de 48 h y, si aún así la tabla supera MAX_ROWS,
 * conserva solo las filas más recientes (grupos muy activos).
 */
export function purgeOldProcessedMessages(): void {
  const cutoff = new Date(Date.now() - RETENTION_MS);
  db.delete(processedMessages).where(lt(processedMessages.processedAt, cutoff)).run();
  db.run(sql`
    DELETE FROM processed_messages
    WHERE message_id NOT IN (
      SELECT message_id FROM processed_messages
      ORDER BY processed_at DESC
      LIMIT ${MAX_ROWS}
    )
  `);
}

/** Cantidad de mensajes registrados (úsalo en tests/diagnóstico). */
export function countProcessedMessages(): number {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(processedMessages)
    .get();
  return row?.count ?? 0;
}
