import { and, asc, eq, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { db as defaultDb, type Db } from '../db/index.js';
import { reminders, type Reminder } from '../db/schema.js';
import { jidToPhone } from '../utils/jid.js';
import type { MentionRef } from './mentions.js';

/** Claims vencidos (la instancia murió a mitad de ejecución) se liberan tras este tiempo. */
const CLAIM_TIMEOUT_MS = 5 * 60 * 1000;

/** Display label fallback for a bare JID (`@` + phone digits, or `@` + JID). */
function labelForJid(jid: string): string {
  return `@${jidToPhone(jid) ?? jid}`;
}

/**
 * Serialize mentions for the nullable `mentions` text column.
 * Plain JIDs keep the legacy JSON string-array format; resolved
 * `{jid, label}` refs are stored as a JSON object array.
 */
export function serializeMentions(mentions?: ReadonlyArray<string | MentionRef>): string | null {
  if (!mentions || mentions.length === 0) return null;
  if (mentions.every((m): m is string => typeof m === 'string')) {
    return JSON.stringify(mentions);
  }
  const refs: MentionRef[] = [];
  const seen = new Set<string>();
  for (const m of mentions) {
    const ref: MentionRef =
      typeof m === 'string' ? { jid: m, label: labelForJid(m) } : m;
    if (!ref.jid || seen.has(ref.jid)) continue;
    seen.add(ref.jid);
    refs.push({
      jid: ref.jid,
      label: ref.label && ref.label.length > 0 ? ref.label : labelForJid(ref.jid),
    });
  }
  if (refs.length === 0) return null;
  return JSON.stringify(refs);
}

/**
 * Parse the nullable `mentions` column into `{jid, label}` refs (never throws).
 * Reads the current object format and the legacy plain-JID array (labels are
 * derived as `@digits` for the latter).
 */
export function parseMentionRefs(raw: string | null): MentionRef[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const refs: MentionRef[] = [];
    for (const entry of parsed) {
      if (typeof entry === 'string') {
        if (entry.length === 0) continue;
        refs.push({ jid: entry, label: labelForJid(entry) });
      } else if (isStoredRef(entry)) {
        const rawLabel: unknown = entry.label;
        refs.push({
          jid: entry.jid,
          label: typeof rawLabel === 'string' && rawLabel.length > 0 ? rawLabel : labelForJid(entry.jid),
        });
      }
    }
    return refs;
  } catch {
    return [];
  }
}

function isStoredRef(entry: unknown): entry is { jid: string; label?: unknown } {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    typeof (entry as { jid?: unknown }).jid === 'string' &&
    ((entry as { jid: string }).jid.length > 0)
  );
}

/** True when the stored payload already carries display labels (object format). */
export function mentionsHaveLabels(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.some((entry) => isStoredRef(entry));
  } catch {
    return false;
  }
}

/** Parse the nullable `mentions` text column back into JIDs (never throws). */
export function parseMentions(raw: string | null): string[] {
  return parseMentionRefs(raw).map((ref) => ref.jid);
}

export class ReminderService {
  constructor(private readonly db: Db = defaultDb) {}

  create(input: {
    groupJid: string;
    creatorJid: string;
    creatorName: string | null;
    message: string;
    scheduledAt: Date;
    mentions?: Array<string | MentionRef>;
  }): Reminder {
    const now = new Date();
    const row = this.db
      .insert(reminders)
      .values({
        groupJid: input.groupJid,
        creatorJid: input.creatorJid,
        creatorName: input.creatorName,
        message: input.message,
        mentions: serializeMentions(input.mentions),
        scheduledAt: input.scheduledAt,
        status: 'PENDING',
        createdAt: now,
      })
      .returning()
      .get();
    return row;
  }

  /** Próximos recordatorios pendientes del grupo (más antiguo primero). */
  listPendingByGroup(groupJid: string, limit = 10): Reminder[] {
    return this.db
      .select()
      .from(reminders)
      .where(and(eq(reminders.groupJid, groupJid), eq(reminders.status, 'PENDING')))
      .orderBy(asc(reminders.scheduledAt))
      .limit(limit)
      .all();
  }

  getById(id: number): Reminder | undefined {
    return this.db.select().from(reminders).where(eq(reminders.id, id)).get();
  }

  /**
   * Cancela un recordatorio pendiente del grupo. Devuelve:
   *  - el recordatorio cancelado,
   *  - 'not-found' si no existe en ese grupo,
   *  - 'not-pending' si ya fue ejecutado/cancelado.
   */
  cancelInGroup(
    id: number,
    groupJid: string,
  ): { result: Reminder } | { result: 'not-found' | 'not-pending' } {
    const existing = this.db
      .select()
      .from(reminders)
      .where(and(eq(reminders.id, id), eq(reminders.groupJid, groupJid)))
      .get();
    if (!existing) return { result: 'not-found' };
    if (existing.status !== 'PENDING') return { result: 'not-pending' };
    const updated = this.db
      .update(reminders)
      .set({ status: 'CANCELLED' })
      .where(and(eq(reminders.id, id), eq(reminders.status, 'PENDING')))
      .returning()
      .get();
    if (!updated) return { result: 'not-pending' }; // carrera con el scheduler
    return { result: updated };
  }

  /**
   * Toma (claim) hasta `batchSize` recordatorios vencidos de forma atómica.
   * UPDATE con guarda status='PENDING' + RETURNING: si dos instancias compiten,
   * solo una obtiene cada fila. Claims con más de CLAIM_TIMEOUT_MS se consideran
   * abandonados (la instancia murió antes de enviar) y pueden retomarse.
   * Respeta nextRetryAt (backoff de reintentos tras fallos de envío).
   */
  claimDue(now: Date, batchSize = 20): Reminder[] {
    const claimCutoff = new Date(now.getTime() - CLAIM_TIMEOUT_MS);
    const claimedAt = now;

    return this.db.transaction((tx) => {
      const due = tx
        .select({ id: reminders.id })
        .from(reminders)
        .where(
          and(
            eq(reminders.status, 'PENDING'),
            lte(reminders.scheduledAt, now),
            or(isNull(reminders.nextRetryAt), lte(reminders.nextRetryAt, now)),
            or(isNull(reminders.claimedAt), lt(reminders.claimedAt, claimCutoff)),
          ),
        )
        .orderBy(asc(reminders.scheduledAt))
        .limit(batchSize)
        .all();

      const claimed: Reminder[] = [];
      for (const { id } of due) {
        const row = tx
          .update(reminders)
          .set({ claimedAt })
          .where(and(eq(reminders.id, id), eq(reminders.status, 'PENDING')))
          .returning()
          .get();
        if (row) claimed.push(row);
      }
      return claimed;
    });
  }

  /**
   * Marca como ejecutado solo si sigue PENDING (un admin pudo cancelarlo mientras tanto).
   * Resetea attempts para que el historial refleje un envío limpio.
   */
  markExecuted(id: number): boolean {
    const result = this.db
      .update(reminders)
      .set({ status: 'EXECUTED', executedAt: new Date(), attempts: 0, nextRetryAt: null })
      .where(and(eq(reminders.id, id), eq(reminders.status, 'PENDING')))
      .run();
    return result.changes > 0;
  }

  /**
   * Registra un fallo de envío: libera el claim y programa el próximo reintento
   * con backoff exponencial (1min, 2min, 4min... hasta 1h). Persistido en DB,
   * así que sobrevive reinicios.
   */
  registerFailure(id: number, now = new Date()): void {
    const row = this.getById(id);
    if (!row || row.status !== 'PENDING') return;
    const attempts = row.attempts + 1;
    const backoffMs = Math.min(60_000 * 2 ** Math.min(attempts - 1, 10), 3_600_000);
    this.db
      .update(reminders)
      .set({
        claimedAt: null,
        attempts,
        nextRetryAt: new Date(now.getTime() + backoffMs),
      })
      .where(and(eq(reminders.id, id), eq(reminders.status, 'PENDING')))
      .run();
  }

  countPendingByGroup(groupJid: string): number {
    return this.listPendingByGroup(groupJid, 1000).length;
  }

  /** Total de pendientes (todas las salas) — usado en /health. */
  countAllPending(): number {
    const row = this.db
      .select({ count: sql<number>`count(*)` })
      .from(reminders)
      .where(eq(reminders.status, 'PENDING'))
      .get();
    return row?.count ?? 0;
  }
}
