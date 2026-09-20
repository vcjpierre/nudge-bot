import type { GroupMetadata } from 'baileys';
import type { GroupService } from '../groups/service.js';
import type { ReminderService } from '../reminders/service.js';
import type { CommandHandler } from './handler.js';
import type { PermissionLevel } from '../whatsapp/permissions.js';

/** Categorías para agrupar comandos en /ayuda (y futuro panel). */
export type CommandCategory = 'recordatorios' | 'admin' | 'general';

/** Servicios disponibles para todos los comandos (inyección de dependencias). */
export interface Services {
  reminders: ReminderService;
  groups: GroupService;
}

/** Contexto completo que recibe cada comando al ejecutarse. */
export interface CommandContext {
  groupJid: string;
  senderJid: string;
  senderPn?: string;
  pushName: string | null;
  /** Texto completo después del nombre del comando. */
  args: string;
  /** Args divididos por espacios. */
  tokens: string[];
  services: Services;
  /** Enviar un mensaje al grupo del que vino el comando. */
  reply: (text: string) => Promise<void>;
  /** Reaccionar al mensaje del comando (✅, ❌, etc.). */
  react: (emoji: string) => Promise<void>;
  /** Zona horaria efectiva del grupo (override del grupo o TIMEZONE global). */
  timezone: string;
  /** Metadata del grupo (obtenida solo cuando el comando no es EVERYONE). */
  groupMetadata: GroupMetadata | null;
  /** Obtiene metadata fresca del grupo (la pide a WhatsApp en el momento). */
  fetchGroupMetadata: () => Promise<GroupMetadata | null>;
  /** Handler que procesó el comando (p. ej. para verificar si alguien es owner). */
  handler: CommandHandler;
  /** Registry completo (p. ej. /ayuda lista los comandos registrados). */
  registry: import('./registry.js').CommandRegistry;
}

export interface Command {
  name: string;
  aliases?: string[];
  description: string;
  usage: string;
  permission: PermissionLevel;
  /** Agrupa el comando en /ayuda. Default: 'general'. */
  category?: CommandCategory;
  /**
   * Si es true, el comando también funciona en grupos NO autorizados
   * (necesario para /autorizar-grupo). El permiso se valida igual.
   */
  allowUnauthorizedGroup?: boolean;
  execute: (ctx: CommandContext) => Promise<void>;
}
