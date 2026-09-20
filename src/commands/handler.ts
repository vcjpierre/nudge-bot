import type { GroupMetadata, WAMessage, WAMessageKey } from 'baileys';
import { tryMarkMessageProcessed } from '../db/message-guard.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import {
  extractIncomingMessage,
  parseCommandText,
  type IncomingMessage,
} from '../whatsapp/messages.js';
import { hasPermission, isBotOwner, type OwnerConfig } from '../whatsapp/permissions.js';
import type { WhatsAppClient } from '../whatsapp/client.js';
import type { CommandRegistry } from './registry.js';
import { RateLimiter } from './rate-limiter.js';
import type { CommandContext, Services } from './types.js';

const MAX_COMMAND_LENGTH = 1_000;
const GROUP_METADATA_TTL_MS = 60_000;

interface MetadataCacheEntry {
  metadata: GroupMetadata;
  expiresAt: number;
}

export interface CommandMetrics {
  commandsProcessed: number;
  commandsFailed: number;
}

/**
 * Procesa mensajes entrantes y ejecuta comandos.
 *
 * Flujo: extraer → descartar (no grupo, propio bot, sin "/") → idempotencia →
 * rate limit → comando existe → grupo autorizado → permisos → ejecutar.
 * Ningún error de un comando detiene el proceso principal.
 */
export class CommandHandler {
  private readonly rateLimiter = new RateLimiter();
  private readonly owner: OwnerConfig;
  private metadataCache = new Map<string, MetadataCacheEntry>();
  private readonly metrics: CommandMetrics = { commandsProcessed: 0, commandsFailed: 0 };

  constructor(
    private readonly client: WhatsAppClient,
    private readonly registry: CommandRegistry,
    private readonly services: Services,
  ) {
    this.owner = {
      ownerJid: env.BOT_OWNER_JID ?? `${env.BOT_OWNER_NUMBER}@s.whatsapp.net`,
      ownerNumber: env.BOT_OWNER_NUMBER,
    };
  }

  /** Punto de entrada para cada WAMessage recibido. */
  async handleMessage(msg: WAMessage): Promise<void> {
    const incoming = extractIncomingMessage(msg);
    if (!incoming) return;

    if (incoming.text.length > MAX_COMMAND_LENGTH) return; // sin respuesta: spam

    const parsed = parseCommandText(incoming.text);
    if (!parsed) return;

    // Idempotencia: WhatsApp puede re-entregar el mismo mensaje.
    if (!tryMarkMessageProcessed(incoming.messageId)) {
      logger.debug({ messageId: incoming.messageId }, 'mensaje duplicado ignorado');
      return;
    }

    const command = this.registry.get(parsed.name);
    if (!command) {
      await this.reply(incoming.groupJid, `❓ Comando desconocido "/${parsed.name}". Escribe /ayuda para ver los disponibles.`);
      return;
    }

    // Rate limiting (antes de trabajo pesado).
    const rl = this.rateLimiter.check(incoming.senderJid, incoming.groupJid);
    if (!rl.allowed) {
      if (rl.firstViolation) {
        await this.reply(incoming.groupJid, '⏳ Demasiados comandos. Espera un momento.');
      }
      return;
    }

    // Whitelist de grupos.
    const authorized = this.services.groups.isAuthorized(incoming.groupJid);
    if (!authorized && !command.allowUnauthorizedGroup) {
      return; // ignorar en silencio: no filtrar existencia del bot a grupos ajenos
    }

    // Metadata del grupo (con caché) para permisos de admin.
    let metadata: GroupMetadata | null = null;
    if (command.permission !== 'EVERYONE') {
      metadata = await this.getGroupMetadata(incoming.groupJid);
    }

    // Permisos.
    const allowed = hasPermission({
      required: command.permission,
      senderJid: incoming.senderJid,
      ...(incoming.senderPn ? { senderPn: incoming.senderPn } : {}),
      owner: this.owner,
      ...(metadata ? { groupMetadata: metadata } : {}),
    });
    if (!allowed) {
      await this.reply(incoming.groupJid, '🚫 No tienes permiso para usar este comando.');
      return;
    }

    const timezone = this.services.groups.getTimezone(incoming.groupJid) ?? env.TIMEZONE;

    const ctx: CommandContext = {
      groupJid: incoming.groupJid,
      senderJid: incoming.senderJid,
      ...(incoming.senderPn ? { senderPn: incoming.senderPn } : {}),
      pushName: incoming.pushName,
      args: parsed.args,
      tokens: parsed.args ? parsed.args.split(/\s+/) : [],
      services: this.services,
      reply: (text) => this.reply(incoming.groupJid, text),
      react: (emoji) => this.react(msg.key, emoji),
      timezone,
      groupMetadata: metadata,
      fetchGroupMetadata: () => this.getGroupMetadata(incoming.groupJid),
      handler: this,
      registry: this.registry,
    };

    logger.info(
      { command: command.name, groupJid: incoming.groupJid, senderJid: incoming.senderJid },
      'ejecutando comando',
    );
    this.metrics.commandsProcessed += 1;

    try {
      await command.execute(ctx);
    } catch (error) {
      this.metrics.commandsFailed += 1;
      logger.error({ err: error, command: command.name }, 'error ejecutando comando');
      await this.react(msg.key, '❌');
      await this.reply(
        incoming.groupJid,
        '⚠️ Ocurrió un error interno al ejecutar el comando. Inténtalo de nuevo.',
      ).catch(() => undefined);
    }
  }

  getMetrics(): CommandMetrics {
    return { ...this.metrics };
  }

  /** true si el JID corresponde al owner (usado por /ayuda para filtrar). */
  isOwner(senderJid: string, senderPn?: string): boolean {
    return isBotOwner(this.owner, senderJid, senderPn);
  }

  /** Metadata con caché de 60 s para no saturar WhatsApp. */
  async getGroupMetadata(groupJid: string): Promise<GroupMetadata | null> {
    const cached = this.metadataCache.get(groupJid);
    if (cached && cached.expiresAt > Date.now()) return cached.metadata;
    try {
      const metadata = await this.client.getGroupMetadata(groupJid);
      this.metadataCache.set(groupJid, {
        metadata,
        expiresAt: Date.now() + GROUP_METADATA_TTL_MS,
      });
      return metadata;
    } catch (error) {
      logger.warn({ err: error, groupJid }, 'no se pudo obtener metadata del grupo');
      return null;
    }
  }

  private async reply(groupJid: string, text: string): Promise<void> {
    try {
      await this.client.sendText(groupJid, text);
    } catch (error) {
      logger.error({ err: error, groupJid }, 'no se pudo enviar respuesta');
    }
  }

  /** Reacciona al mensaje del comando. Fallos se ignoran (es solo feedback). */
  private async react(key: WAMessageKey | undefined, emoji: string): Promise<void> {
    if (!key?.remoteJid || !key.id) return;
    try {
      await this.client.sendRaw(key.remoteJid, {
        react: { text: emoji, key },
      });
    } catch (error) {
      logger.debug({ err: error }, 'no se pudo enviar reacción');
    }
  }
}
