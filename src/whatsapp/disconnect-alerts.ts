import type { WASocket } from 'baileys';
import { logger } from '../utils/logger.js';
import { phoneToJid } from '../utils/jid.js';

const MAX_ALERTS_PER_HOUR = 3;
const ALERT_WINDOW_MS = 60 * 60 * 1000;

/**
 * Envía alertas de desconexión al propietario del bot (chat privado),
 * con rate limit para no hacer spam si la conexión cae en bucle.
 */
export class DisconnectAlerter {
  private sentAt: number[] = [];

  constructor(
    private readonly socket: WASocket,
    private readonly ownerNumber: string,
  ) {}

  async notifyDisconnect(reason: string): Promise<void> {
    const now = Date.now();
    this.sentAt = this.sentAt.filter((ts) => now - ts < ALERT_WINDOW_MS);
    if (this.sentAt.length >= MAX_ALERTS_PER_HOUR) {
      logger.warn('alerta de desconexión suprimida por rate limit');
      return;
    }
    this.sentAt.push(now);
    try {
      await this.socket.sendMessage(phoneToJid(this.ownerNumber), {
        text: `⚠️ Bot desconectado de WhatsApp.\nMotivo: ${reason}\nHora: ${new Date(now).toISOString()}`,
      });
    } catch (error) {
      logger.warn({ err: error }, 'no se pudo enviar la alerta de desconexión al owner');
    }
  }
}
