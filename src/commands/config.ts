import { z } from 'zod';
import { env } from '../config/env.js';
import { formatForUser } from '../reminders/scheduler.js';
import type { Command } from './types.js';

const timezoneSchema = z
  .string()
  .min(1)
  .max(50)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('es', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Zona horaria IANA inválida (ej: America/La_Paz)');

/**
 * Configuración por grupo. Punto de extensión para futuras opciones
 * (idioma, formato de fecha, módulos habilitados, etc.).
 */
export const configCommand: Command = {
  name: 'config',
  description: 'Configura opciones del grupo (por ahora: zona horaria)',
  usage: '/config zona <IANA|reset> — ej: /config zona America/Buenos_Aires',
  permission: 'GROUP_ADMIN',
  category: 'admin',
  execute: async (ctx) => {
    const [subcommand, value] = ctx.tokens;

    if (subcommand === 'zona') {
      if (value === 'reset') {
        ctx.services.groups.setTimezone(ctx.groupJid, null);
        await ctx.reply(`✅ Zona horaria restablecida a la global del bot (${env.TIMEZONE}).`);
        return;
      }
      const check = timezoneSchema.safeParse(value ?? '');
      if (!check.success) {
        await ctx.reply(`⚠️ Uso: ${configCommand.usage}`);
        return;
      }
      ctx.services.groups.setTimezone(ctx.groupJid, check.data);
      await ctx.reply(
        `✅ Zona horaria del grupo: ${check.data} (ahora ${formatForUser(new Date(), check.data)}).\nLos nuevos recordatorios se interpretarán con esa zona.`,
      );
      return;
    }

    const current = ctx.services.groups.getTimezone(ctx.groupJid);
    await ctx.reply(
      `⚙️ Configuración del grupo:\n• Zona horaria: ${current ?? `${env.TIMEZONE} (global)`}\n\nSubcomandos: zona`,
    );
  },
};
