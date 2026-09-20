import { formatForUser } from '../reminders/scheduler.js';
import type { Command } from './types.js';

const MAX_MESSAGE_PREVIEW = 60;

function truncate(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ');
  return oneLine.length > MAX_MESSAGE_PREVIEW
    ? `${oneLine.slice(0, MAX_MESSAGE_PREVIEW)}…`
    : oneLine;
}

export const listRemindersCommand: Command = {
  name: 'recordatorios',
  aliases: ['lista-recordatorios'],
  description: 'Lista los próximos recordatorios pendientes del grupo',
  usage: '/recordatorios',
  permission: 'EVERYONE',
  category: 'recordatorios',
  execute: async (ctx) => {
    const pending = ctx.services.reminders.listPendingByGroup(ctx.groupJid, 10);
    if (pending.length === 0) {
      await ctx.reply('📋 No hay recordatorios pendientes en este grupo.');
      return;
    }
    const lines = pending.map((r) => {
      const creator = r.creatorName ? ` — ${r.creatorName}` : '';
      const retry = r.attempts > 0 ? ` ⚠️(reintento ${r.attempts})` : '';
      return `#${r.id} · ${formatForUser(r.scheduledAt, ctx.timezone)}${creator}${retry}\n   ${truncate(r.message)}`;
    });
    await ctx.reply(`📋 Próximos recordatorios:\n\n${lines.join('\n')}`);
  },
};
