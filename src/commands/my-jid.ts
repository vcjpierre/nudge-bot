import type { Command } from './types.js';

export const myJidCommand: Command = {
  name: 'mijid',
  description: 'Muestra tu identificador (JID) de WhatsApp, útil para configurar BOT_OWNER_JID',
  usage: '/mijid',
  permission: 'EVERYONE',
  allowUnauthorizedGroup: true, // así el owner puede descubrir su JID antes de autorizar
  category: 'general',
  execute: async (ctx) => {
    const pn = ctx.senderPn ? `\nNúmero: ${ctx.senderPn}` : '';
    await ctx.reply(`🪪 Tu JID: ${ctx.senderJid}${pn}`);
  },
};
