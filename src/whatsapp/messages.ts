import type { WAMessage } from 'baileys';
import { isGroupJid, normalizeJid } from '../utils/jid.js';

/** Datos normalizados de un mensaje entrante que podría ser un comando. */
export interface IncomingMessage {
  messageId: string;
  groupJid: string;
  senderJid: string;
  senderPn?: string;
  pushName: string | null;
  text: string;
}

/**
 * Extrae el texto visible de un mensaje (incluye captions y respuestas
 * de listas/botones por si en el futuro se usan).
 */
function extractText(msg: WAMessage): string | null {
  const m = msg.message;
  if (!m) return null;
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.listResponseMessage?.title ??
    m.buttonsResponseMessage?.selectedButtonId ??
    null
  );
}

/**
 * Convierte un WAMessage crudo en IncomingMessage si es procesable.
 * Devuelve null cuando:
 *  - no viene de un grupo (los privados se ignoran por ahora);
 *  - fue enviado por el propio bot;
 *  - es un mensaje de sistema/estado (newsletters, broadcast, protocol);
 *  - no tiene texto ni ID.
 */
export function extractIncomingMessage(msg: WAMessage): IncomingMessage | null {
  const key = msg.key;
  if (!key?.id || !key.remoteJid) return null;
  if (key.fromMe) return null;
  if (!isGroupJid(key.remoteJid)) return null;
  if (key.remoteJid === 'status@broadcast') return null;

  const senderRaw = key.participant ?? (msg as { participant?: string }).participant;
  if (!senderRaw) return null;

  const text = extractText(msg);
  if (!text) return null;

  const senderPn = (key as { participantPn?: string }).participantPn;
  return {
    messageId: key.id,
    groupJid: key.remoteJid,
    senderJid: normalizeJid(senderRaw),
    ...(senderPn ? { senderPn: normalizeJid(senderPn) } : {}),
    pushName: msg.pushName ?? null,
    text: text.trim(),
  };
}

/** Prefijo de comandos. */
export const COMMAND_PREFIX = '/';

export interface ParsedCommand {
  name: string;
  args: string;
}

/**
 * Parsea un texto como comando. Devuelve null si no empieza con '/'
 * o si el nombre está vacío ("/", "/ ").
 */
export function parseCommandText(text: string): ParsedCommand | null {
  if (!text.startsWith(COMMAND_PREFIX)) return null;
  const body = text.slice(COMMAND_PREFIX.length).trim();
  if (!body) return null;
  const spaceIndex = body.search(/\s/);
  if (spaceIndex === -1) {
    return { name: body.toLowerCase(), args: '' };
  }
  return {
    name: body.slice(0, spaceIndex).toLowerCase(),
    args: body.slice(spaceIndex + 1).trim(),
  };
}
