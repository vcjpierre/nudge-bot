import type { Command } from './types.js';

export const authorizeGroupCommand: Command = {
  name: 'autorizar-grupo',
  description: 'Autoriza este grupo para usar el bot',
  usage: '/autorizar-grupo',
  permission: 'BOT_OWNER',
  allowUnauthorizedGroup: true,
  execute: async (ctx) => {
    // Metadata fresca para guardar el nombre real del grupo.
    const metadata = await ctx.fetchGroupMetadata();
    const name = metadata?.subject ?? 'Grupo sin nombre';
    ctx.services.groups.authorize(ctx.groupJid, name);
    await ctx.reply(`✅ Grupo "${name}" autorizado. Ya pueden usar /recordatorio y /ayuda.`);
  },
};
