import { z } from 'zod';
import type { Command } from './types.js';

const idSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const deleteReminderCommand: Command = {
  name: 'eliminar',
  aliases: ['borrar'],
  description: 'Cancela un recordatorio pendiente (no lo borra, solo lo desactiva)',
  usage: '/eliminar <id>',
  permission: 'GROUP_ADMIN',
  category: 'recordatorios',
  execute: async (ctx) => {
    const idCheck = idSchema.safeParse(ctx.tokens[0]);
    if (!idCheck.success) {
      await ctx.reply(`⚠️ Uso: ${deleteReminderCommand.usage}`);
      return;
    }
    const outcome = ctx.services.reminders.cancelInGroup(idCheck.data, ctx.groupJid);
    if (outcome.result === 'not-found') {
      await ctx.reply(`⚠️ No existe el recordatorio #${idCheck.data} en este grupo.`);
    } else if (outcome.result === 'not-pending') {
      await ctx.reply(`⚠️ El recordatorio #${idCheck.data} ya fue ejecutado o cancelado.`);
    } else {
      await ctx.react('✅');
      await ctx.reply(`🗑️ Recordatorio #${idCheck.data} cancelado.`);
    }
  },
};
