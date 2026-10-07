import { Boom } from '@hapi/boom';
import {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeWASocket,
  useMultiFileAuthState,
  type AnyMessageContent,
  type WASocket,
  type WAMessage,
} from 'baileys';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import pino from 'pino';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { DisconnectAlerter } from './disconnect-alerts.js';

const require = createRequire(import.meta.url);
const qrcodeTerminal = require('qrcode-terminal') as {
  generate: (input: string, opts?: { small: boolean }, callback?: (qrcode: string) => void) => void;
};
// generate() uses `this.error` internally, so it must stay bound to its
// module object; a bare destructured reference throws "bad rs block".
const printQRCode: typeof qrcodeTerminal.generate =
  qrcodeTerminal.generate.bind(qrcodeTerminal);

export type MessageHandler = (msg: WAMessage) => Promise<void>;

const MIN_RECONNECT_DELAY_MS = 3_000;
const MAX_RECONNECT_DELAY_MS = 60_000;
const WATCHDOG_INTERVAL_MS = 60_000;
const WATCHDOG_STALE_MS = 5 * 60_000;

/**
 * Cliente de WhatsApp basado en Baileys.
 *
 *  - Persistencia de sesión en AUTH_DIR (no hace falta re-vincular tras reinicios).
 *  - Primera ejecución: vinculación con código de emparejamiento (8 dígitos) que
 *    se muestra en consola/log. En WhatsApp: Dispositivos vinculados > Vincular
 *    con número de teléfono.
 *  - Reconexión automática con backoff exponencial ante cortes de red.
 *  - No reconecta si la sesión fue cerrada (loggedOut): requiere borrar AUTH_DIR
 *    y vincular de nuevo.
 */
export class WhatsAppClient {
  private socket: WASocket | null = null;
  private handler: MessageHandler | null = null;
  private alerter: DisconnectAlerter | null = null;
  private reconnectDelay = MIN_RECONNECT_DELAY_MS;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopping = false;
  private connecting: Promise<void> | null = null;
  private lastActivityAt = 0; // epoch ms de la última señal de vida del socket
  private watchdogTimer: NodeJS.Timeout | null = null;
  private currentPairingCode: string | null = null;
  private lastPrintedQR: string | null = null;

  /** Registra el handler de mensajes entrantes (llamar antes de connect). */
  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  /** true cuando el socket está abierto y autenticado. */
  isConnected(): boolean {
    return this.socket?.user != null;
  }

  async connect(): Promise<void> {
    if (this.connecting) return this.connecting;
    this.connecting = this.doConnect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async doConnect(): Promise<void> {
    this.closePreviousSocket();
    const { state, saveCreds } = await useMultiFileAuthState(env.AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();
    logger.info({ version: version.join('.') }, 'versión de WhatsApp Web obtenida');

    const socket = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }) as never,
      printQRInTerminal: false,
      browser: Browsers.macOS('Desktop'),
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });
    this.socket = socket;
    this.alerter = new DisconnectAlerter(socket, env.BOT_OWNER_NUMBER);

    socket.ev.on('creds.update', saveCreds);

    socket.ev.on('connection.update', (update) => {
      void this.handleConnectionUpdate(update, socket);
    });

    socket.ev.on('messages.upsert', ({ messages, type }) => {
      this.lastActivityAt = Date.now();
      if (type !== 'notify') return;
      for (const msg of messages) {
        if (!this.handler) continue;
        this.handler(msg).catch((error) => {
          logger.error({ err: error, msgId: msg.key?.id }, 'error procesando mensaje');
        });
      }
    });

    // First run in code mode: unregistered creds -> link with a pairing code.
    // In qr mode this block is skipped; linking happens via the QR printed
    // from the connection.update handler.
    // Request a new code only when no valid code exists in this process;
    // otherwise reuse it so reconnects (e.g. 428 transport close) do not
    // invalidate the code the user is about to enter.
    if (!state.creds.registered && env.LINK_METHOD === 'code') {
      const persisted =
        typeof state.creds.pairingCode === 'string' && state.creds.pairingCode.length > 0
          ? state.creds.pairingCode
          : null;
      if (persisted) {
        this.currentPairingCode = persisted;
        logger.warn(
          { pairingCode: persisted },
          'Reusing active pairing code from disk; enter it in WhatsApp: Linked devices > Link with phone number',
        );
      } else if (this.currentPairingCode) {
        logger.warn(
          { pairingCode: this.currentPairingCode },
          'Reusing active pairing code; enter it in WhatsApp: Linked devices > Link with phone number',
        );
      } else {
        await this.requestPairing(socket);
      }
    }
  }

  /** Close the previous socket before replacing it to avoid leaking listeners. */
  private closePreviousSocket(): void {
    if (!this.socket) return;
    try {
      this.socket.end(undefined);
    } catch {
      // Ignore close errors; the socket is being replaced anyway.
    }
    this.socket = null;
  }

  /**
   * Watchdog: si el socket lleva "abierto" pero sin actividad durante
   * WATCHDOG_STALE_MS (socket zombi, Baileys a veces no emite 'close'),
   * fuerza reconexión. Se activa al conectar y se detiene al cerrar.
   */
  private startWatchdog(): void {
    this.stopWatchdog();
    this.watchdogTimer = setInterval(() => {
      if (this.stopping || !this.socket) return;
      const staleFor = Date.now() - this.lastActivityAt;
      if (staleFor > WATCHDOG_STALE_MS) {
        logger.warn({ staleForMs: staleFor }, 'socket sin actividad; forzando reconexión');
        this.socket.end(undefined);
        this.socket = null;
        this.scheduleReconnect();
      }
    }, WATCHDOG_INTERVAL_MS);
    this.watchdogTimer.unref?.();
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private async requestPairing(socket: WASocket): Promise<void> {
    if (!env.PHONE_NUMBER) {
      logger.error(
        'No hay sesión de WhatsApp y falta PHONE_NUMBER en el .env. ' +
          'Configúralo (solo dígitos, con código de país) y reinicia para vincular el número.',
      );
      return;
    }
    // El socket debe estar listo para solicitar el código.
    await socket.waitForSocketOpen().catch(() => undefined);
    try {
      const code = await socket.requestPairingCode(env.PHONE_NUMBER);
      this.currentPairingCode = code;
      logger.warn(
        { pairingCode: code },
        `New pairing code generated; enter it in WhatsApp: Linked devices > Link with phone number: ${code}`,
      );
    } catch (error) {
      logger.error({ err: error }, 'no se pudo solicitar el código de vinculación');
    }
  }

  private async handleConnectionUpdate(
    update: { connection?: string; lastDisconnect?: { error?: Error }; qr?: string },
    socket: WASocket,
  ): Promise<void> {
    const { connection, lastDisconnect } = update;

    // QR linking flow: Baileys emits a fresh QR string while unregistered.
    // Print each new one to the terminal so it can be scanned.
    if (
      env.LINK_METHOD === 'qr' &&
      typeof update.qr === 'string' &&
      update.qr.length > 0 &&
      !socket.authState.creds.registered &&
      update.qr !== this.lastPrintedQR
    ) {
      this.lastPrintedQR = update.qr;
      printQRCode(update.qr, { small: true });
      logger.warn(
        'Scan the QR code above in WhatsApp: Linked devices > Link a device. ' +
          'It expires in ~30s; a fresh code will be printed automatically.',
      );
    }

    if (connection === 'open') {
      this.reconnectDelay = MIN_RECONNECT_DELAY_MS;
      this.lastActivityAt = Date.now();
      this.currentPairingCode = null;
      this.lastPrintedQR = null;
      this.startWatchdog();
      logger.info({ user: socket.user?.id }, 'conectado a WhatsApp');
      return;
    }

    if (connection !== 'close') return;

    if (this.stopping) {
      logger.info('conexión cerrada (shutdown)');
      return;
    }

    this.stopWatchdog();
    const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
    const reason = DisconnectReason[statusCode ?? 0] ?? `código ${statusCode ?? 'desconocido'}`;
    logger.warn({ statusCode, reason }, 'conexión cerrada');

    if (statusCode === DisconnectReason.loggedOut) {
      this.currentPairingCode = null;
      this.lastPrintedQR = null;
      logger.error(
        `La sesión fue cerrada desde WhatsApp. Borra el directorio ${path.resolve(env.AUTH_DIR)} y vuelve a vincular el número.`,
      );
      this.stopping = true;
      return;
    }

    const registered = socket.authState.creds.registered;
    if (!registered) {
      logger.warn(
        { statusCode, reason },
        'Transport closed while awaiting pairing; reconnecting transport without requesting a new pairing code',
      );
      this.scheduleReconnect();
      return;
    }

    await this.alerter?.notifyDisconnect(reason);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.stopping) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
    logger.info({ delayMs: delay }, 'reconectando...');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((error) => {
        logger.error({ err: error }, 'error en reconexión');
        this.scheduleReconnect();
      });
    }, delay);
  }

  async sendText(jid: string, text: string, mentions?: string[]): Promise<void> {
    if (!this.socket || !this.isConnected()) {
      throw new Error('El bot no está conectado a WhatsApp');
    }
    await this.socket.sendMessage(jid, {
      text,
      ...(mentions && mentions.length > 0 ? { mentions } : {}),
    });
  }

  /** Envío de contenido arbitrario (reacciones, futuros polls, imágenes, etc.). */
  async sendRaw(jid: string, content: AnyMessageContent): Promise<void> {
    if (!this.socket || !this.isConnected()) {
      throw new Error('El bot no está conectado a WhatsApp');
    }
    await this.socket.sendMessage(jid, content);
  }

  async getGroupMetadata(jid: string) {
    if (!this.socket) throw new Error('Socket no inicializado');
    return this.socket.groupMetadata(jid);
  }

  /** Indica si ya existe una sesión guardada en disco. */
  hasSavedSession(): boolean {
    return existsSync(path.join(env.AUTH_DIR, 'creds.json'));
  }

  async shutdown(): Promise<void> {
    this.stopping = true;
    this.stopWatchdog();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.end(undefined);
    this.socket = null;
    logger.info('cliente de WhatsApp detenido');
  }
}
