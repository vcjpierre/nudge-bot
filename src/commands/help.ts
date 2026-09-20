import { isGroupAdmin } from '../whatsapp/permissions.js';
import type { Command, CommandCategory } from './types.js';

const PERMISSION_LABEL: Record<string, string> = {
  EVERYONE: '',
  GROUP_ADMIN: ' _(admins)_',
  BOT_OWNER: ' _(owner)_',
};

const CATEGORY_LABEL: Record<CommandCategory, string> = {
  recordatorios: '⏰ Recordatorios',
  admin: '🛠 Administración',
  general: '💬 General',
};

const CATEGORY_ORDER: CommandCategory[] = ['recordatorios', 'general', 'admin'];

export const helpCommand: Command = {
  name: 'ayuda',
  aliases: ['help'],
  description: 'Muestra los comandos disponibles según tus permisos',
  usage: '/ayuda',
  permission: 'EVERYONE',
  allowUnauthorizedGroup: true,
  category: 'general',
  execute: async (ctx) => {
    const isOwner = ctx.handler.isOwner(ctx.senderJid, ctx.senderPn);

    // Metadata fresca solo si hace falta evaluar permisos de admin.
    let isAdmin = isOwner;
    if (!isAdmin) {
      const metadata = await ctx.fetchGroupMetadata();
      if (metadata) {
        isAdmin = isGroupAdmin(metadata, ctx.senderJid, ctx.senderPn);
      }
    }

    const visible = ctx.registry.all().filter((cmd) => {
      if (cmd.permission === 'EVERYONE') return true;
      if (cmd.permission === 'BOT_OWNER') return isOwner; // nunca a usuarios normales
      return isAdmin; // GROUP_ADMIN
    });

    const sections = CATEGORY_ORDER.map((category) => {
      const cmds = visible.filter((c) => (c.category ?? 'general') === category);
      if (cmds.length === 0) return null;
      const lines = cmds.map(
        (cmd) => `/${cmd.name}${PERMISSION_LABEL[cmd.permission] ?? ''} — ${cmd.description}`,
      );
      return `${CATEGORY_LABEL[category]}\n${lines.join('\n')}`;
    }).filter(Boolean);

    await ctx.reply(`🤖 Comandos disponibles:\n\n${sections.join('\n\n')}`);
  },
};
