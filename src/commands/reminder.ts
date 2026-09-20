import { z } from 'zod';
import { ParseError, parseReminderInput } from '../reminders/parser.js';
import { currentTimeForUser, formatForUser } from '../reminders/scheduler.js';
import type { Command } from './types.js';

const messageSchema = z
  .string()
  .min(1)
  .max(300)
  // Sin caracteres de control excepto \n y \t.
  .refine((m) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(m), 'El mensaje contiene caracteres no permitidos');

const MAX_PENDING_PER_GROUP = 50;

export const reminderCommand: Command = {
  name: 'recordatorio',
  aliases: ['recordar', 'r'],
  description: 'Crea un recordatorio para el grupo',
  usage: '/recordatorio <hoy|mañana|dd/mm/aaaa|en N minutos/horas/días> <HH:mm> <mensaje>',
  permission: 'EVERYONE',
  category: 'recordatorios',
  execute: async (ctx) => {
    let parsed;
    try {
      parsed = parseReminderInput(ctx.args, ctx.timezone);
    } catch (error) {
      if (error instanceof ParseError) {
        // Hint contextual: mostrar la hora actual del grupo facilita corregir el comando.
        await ctx.reply(
          `⚠️ ${error.message}\n🕐 Ahora son las ${currentTimeForUser(ctx.timezone)}.\nEjemplo: /recordatorio hoy 18:00 Sacar la basura`,
        );
        await ctx.react('❌');
        return;
      }
      throw error;
    }

    const messageCheck = messageSchema.safeParse(parsed.message);
    if (!messageCheck.success) {
      await ctx.reply('⚠️ El mensaje del recordatorio debe tener entre 1 y 300 caracteres.');
      return;
    }

    if (ctx.services.reminders.countPendingByGroup(ctx.groupJid) >= MAX_PENDING_PER_GROUP) {
      await ctx.reply(`⚠️ El grupo ya tiene ${MAX_PENDING_PER_GROUP} recordatorios pendientes. Cancela algunos con /eliminar <id>.`);
      return;
    }

    const reminder = ctx.services.reminders.create({
      groupJid: ctx.groupJid,
      creatorJid: ctx.senderJid,
      creatorName: ctx.pushName,
      message: messageCheck.data,
      scheduledAt: parsed.scheduledAt,
    });

    await ctx.react('✅');
    await ctx.reply(`✅ Recordatorio #${reminder.id} guardado para el ${formatForUser(reminder.scheduledAt, ctx.timezone)}`);
  },
};
