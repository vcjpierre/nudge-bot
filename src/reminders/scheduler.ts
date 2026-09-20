import { formatInTimeZone } from 'date-fns-tz';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { GroupService } from '../groups/service.js';
import type { Reminder } from '../db/schema.js';
import { ReminderService } from './service.js';

export interface ReminderSender {
  /** Debe lanzar una excepción si el envío falla (para reintentar). */
  sendToGroup(groupJid: string, text: string, mentions?: string[]): Promise<void>;
}

export interface SchedulerOptions {
  intervalMs?: number;
  batchSize?: number;
}

/**
 * Scheduler persistente basado en polling.
 *
 *  - Cada `intervalMs` consulta los recordatorios PENDING ya vencidos (incluye
 *    los que vencieron mientras el bot estuvo apagado) y los procesa en lotes.
 *  - El claim atómico en DB evita ejecuciones duplicadas (reinicios, y de cara
 *    a futuras múltiples instancias).
 *  - Si el envío falla, el claim se libera y se reintenta en el próximo ciclo.
 *  - Ningún error interno detiene el proceso principal.
 */
export class ReminderScheduler {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private readonly intervalMs: number;
  private readonly batchSize: number;

  constructor(
    private readonly service: ReminderService,
    private readonly groups: GroupService,
    private readonly sender: ReminderSender,
    options: SchedulerOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? 15_000;
    this.batchSize = options.batchSize ?? 20;
  }

  start(): void {
    if (this.timer) return;
    logger.info({ intervalMs: this.intervalMs }, 'scheduler de recordatorios iniciado');
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    this.timer.unref?.();
    // Procesar de inmediato lo que haya vencido mientras el bot estuvo apagado.
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Ejecuta un ciclo de procesamiento. Nunca propaga errores. */
  async tick(now: Date = new Date()): Promise<void> {
    if (this.ticking) return; // evita solapamiento si un ciclo tarda más que el intervalo
    this.ticking = true;
    try {
      const due = this.service.claimDue(now, this.batchSize);
      for (const reminder of due) {
        await this.processOne(reminder);
      }
    } catch (error) {
      logger.error({ err: error }, 'error en ciclo del scheduler');
    } finally {
      this.ticking = false;
    }
  }

  private async processOne(reminder: Reminder): Promise<void> {
    const log = logger.child({ reminderId: reminder.id, groupJid: reminder.groupJid });
    try {
      if (!this.groups.isAuthorized(reminder.groupJid)) {
        // El grupo fue desautorizado: se marca EXECUTED para no reintentarlo
        // nunca (no se envía nada a un grupo sin autorización).
        this.service.markExecuted(reminder.id);
        log.warn('grupo no autorizado: recordatorio descartado');
        return;
      }

      const text = reminder.creatorName
        ? `⏰ Recordatorio para ${reminder.creatorName}: ${reminder.message}`
        : `⏰ Recordatorio: ${reminder.message}`;
      await this.sender.sendToGroup(reminder.groupJid, text, [reminder.creatorJid]);

      if (this.service.markExecuted(reminder.id)) {
        log.info('recordatorio enviado y marcado como EXECUTED');
      } else {
        log.info('recordatorio cancelado mientras se enviaba; no se marca EXECUTED');
      }
    } catch (error) {
      log.error({ err: error }, 'fallo al enviar recordatorio; reintento con backoff');
      this.service.registerFailure(reminder.id);
    }
  }
}

/** Formatea una fecha en la zona horaria indicada (o la global del bot). */
export function formatForUser(date: Date, timezone?: string): string {
  return formatInTimeZone(date, timezone ?? env.TIMEZONE, 'dd/MM/yyyy HH:mm');
}

/** Hora actual legible en la zona horaria indicada (para hints de uso). */
export function currentTimeForUser(timezone?: string): string {
  return formatInTimeZone(new Date(), timezone ?? env.TIMEZONE, 'HH:mm');
}
