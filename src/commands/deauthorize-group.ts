import type { Command } from './types.js';

export const deauthorizeGroupCommand: Command = {
  name: 'desautorizar-grupo',
  description: 'Deshabilita el bot en este grupo (los recordatorios pendientes se descartan al vencer)',
  usage: '/desautorizar-grupo',
  permission: 'BOT_OWNER',
  execute: async (ctx) => {
    const removed = ctx.services.groups.deauthorize(ctx.groupJid);
    if (removed) {
      await ctx.reply('🚫 Grupo desautorizado. El bot dejará de responder aquí.');
    } else {
      await ctx.reply('⚠️ Este grupo no estaba autorizado.');
    }
  },
};
