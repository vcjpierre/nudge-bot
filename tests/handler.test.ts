import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { GroupMetadata, WAMessage } from 'baileys';
import { buildCommandRegistry } from '../src/commands/index.js';
import { CommandHandler } from '../src/commands/handler.js';
import { createTestDb, runMigrations, type Db } from '../src/db/index.js';
import { GroupService } from '../src/groups/service.js';
import { ReminderService } from '../src/reminders/service.js';
import type { WhatsAppClient } from '../src/whatsapp/client.js';

const GROUP = '120363012345@g.us';
const OWNER = '59170000001@s.whatsapp.net';
const ADMIN = '59111111111@s.whatsapp.net';
const MEMBER = '59122222222@s.whatsapp.net';

let db: Db;
let reminders: ReminderService;
let groups: GroupService;
let handler: CommandHandler;
let sent: Array<{ jid: string; text?: string; raw?: unknown }>;

function makeMetadata(admins: string[]): GroupMetadata {
  return {
    id: GROUP,
    subject: 'Grupo Test',
    participants: [
      ...admins.map((id) => ({ id, admin: 'admin' as const })),
      { id: MEMBER, admin: null },
    ],
  } as unknown as GroupMetadata;
}

const fakeClient = {
  isConnected: () => true,
  sendText: async (jid: string, text: string) => {
    sent.push({ jid, text });
  },
  sendRaw: async (jid: string, content: unknown) => {
    sent.push({ jid, raw: content });
  },
  getGroupMetadata: async () => makeMetadata([ADMIN]),
} as unknown as WhatsAppClient;

let counter = 0;
function msg(text: string, sender: string, messageId?: string): WAMessage {
  counter += 1;
  return {
    key: {
      id: messageId ?? `MSG-${counter}`,
      remoteJid: GROUP,
      fromMe: false,
      participant: sender,
    },
    pushName: 'Tester',
    message: { conversation: text },
  } as WAMessage;
}

function lastReply(): string {
  const replies = sent.filter((s) => s.text);
  return replies[replies.length - 1]?.text ?? '';
}

function lastReaction(): string {
  const reactions = sent.filter((s) => (s.raw as { react?: { text: string } })?.react);
  return (reactions[reactions.length - 1]?.raw as { react: { text: string } })?.react.text ?? '';
}

beforeAll(() => {
  // La guarda de idempotencia usa la conexión global (':memory:' en tests).
  runMigrations();
});

beforeEach(async () => {
  db = createTestDb();
  reminders = new ReminderService(db);
  groups = new GroupService(db);
  sent = [];
  handler = new CommandHandler(fakeClient, buildCommandRegistry(), { reminders, groups });
  groups.authorize(GROUP, 'Grupo Test');
});

afterEach(() => {
  db.$client.close();
});

describe('CommandHandler E2E', () => {
  it('ignora mensajes que no son comandos', async () => {
    await handler.handleMessage(msg('hola grupo'));
    expect(sent).toHaveLength(0);
  });

  it('ignora mensajes propios del bot', async () => {
    const own = msg('/recordatorio mañana 10:00 X');
    own.key.fromMe = true;
    await handler.handleMessage(own);
    expect(sent).toHaveLength(0);
  });

  it('ignora en silencio comandos de grupos no autorizados', async () => {
    groups.deauthorize(GROUP);
    await handler.handleMessage(msg('/recordatorio mañana 10:00 X', MEMBER));
    expect(sent).toHaveLength(0);
  });

  it('/recordatorio crea y confirma con reacción ✅', async () => {
    await handler.handleMessage(msg('/recordatorio mañana 10:00 Comprar pan', MEMBER));
    const pending = reminders.listPendingByGroup(GROUP);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.message).toBe('Comprar pan');
    expect(lastReply()).toContain('Recordatorio #1 guardado');
    expect(lastReaction()).toBe('✅');
  });

  it('alias /r funciona', async () => {
    await handler.handleMessage(msg('/r mañana 10:00 Corto', MEMBER));
    expect(reminders.listPendingByGroup(GROUP)).toHaveLength(1);
  });

  it('fecha inválida responde con hint y reacción ❌', async () => {
    await handler.handleMessage(msg('/recordatorio ayer 10:00 X', MEMBER));
    expect(lastReply()).toContain('🕐 Ahora son las');
    expect(lastReaction()).toBe('❌');
    expect(reminders.listPendingByGroup(GROUP)).toHaveLength(0);
  });

  it('/recordatorios lista los pendientes', async () => {
    await handler.handleMessage(msg('/recordatorio mañana 10:00 Pan', MEMBER));
    await handler.handleMessage(msg('/recordatorios', MEMBER));
    expect(lastReply()).toContain('Pan');
  });

  it('/eliminar requiere admin; un miembro recibe 🚫', async () => {
    await handler.handleMessage(msg('/recordatorio mañana 10:00 Pan', MEMBER));
    await handler.handleMessage(msg('/eliminar 1', MEMBER));
    expect(lastReply()).toContain('🚫');
    expect(reminders.listPendingByGroup(GROUP)).toHaveLength(1);
  });

  it('/eliminar como admin cancela el recordatorio', async () => {
    await handler.handleMessage(msg('/recordatorio mañana 10:00 Pan', MEMBER));
    await handler.handleMessage(msg('/eliminar 1', ADMIN));
    expect(lastReply()).toContain('cancelado');
    expect(reminders.listPendingByGroup(GROUP)).toHaveLength(0);
  });

  it('/autorizar-grupo solo lo puede el owner, no un admin', async () => {
    groups.deauthorize(GROUP);
    await handler.handleMessage(msg('/autorizar-grupo', ADMIN));
    expect(groups.isAuthorized(GROUP)).toBe(false);
    expect(lastReply()).toContain('🚫');

    await handler.handleMessage(msg('/autorizar-grupo', OWNER));
    expect(groups.isAuthorized(GROUP)).toBe(true);
  });

  it('/ayuda no muestra comandos BOT_OWNER a miembros ni admins', async () => {
    await handler.handleMessage(msg('/ayuda', MEMBER));
    expect(lastReply()).not.toContain('autorizar-grupo');
    await handler.handleMessage(msg('/ayuda', ADMIN));
    expect(lastReply()).not.toContain('autorizar-grupo');
    expect(lastReply()).toContain('/eliminar'); // admin sí ve comandos de admin
  });

  it('/ayuda al owner muestra todos los comandos', async () => {
    await handler.handleMessage(msg('/ayuda', OWNER));
    expect(lastReply()).toContain('autorizar-grupo');
  });

  it('/mijid responde el JID del remitente', async () => {
    await handler.handleMessage(msg('/mijid', MEMBER));
    expect(lastReply()).toContain(MEMBER);
  });

  it('/config zona cambia la zona horaria del grupo (admin)', async () => {
    await handler.handleMessage(msg('/config zona America/Buenos_Aires', ADMIN));
    expect(groups.getTimezone(GROUP)).toBe('America/Buenos_Aires');
    // Nuevos recordatorios usan la zona del grupo (UTC-3: 10:00 → 13:00Z)
    await handler.handleMessage(msg('/recordatorio mañana 10:00 En otra zona', MEMBER));
    const r = reminders.listPendingByGroup(GROUP)[0]!;
    expect(r.scheduledAt.toISOString()).toContain('T13:00:00');
    await handler.handleMessage(msg('/config zona reset', ADMIN));
    expect(groups.getTimezone(GROUP)).toBeNull();
  });

  it('el mismo messageId no se procesa dos veces (idempotencia)', async () => {
    const m = msg('/recordatorio mañana 10:00 Duplicado', MEMBER, 'MSG-DUP');
    await handler.handleMessage(m);
    await handler.handleMessage(m);
    expect(reminders.listPendingByGroup(GROUP)).toHaveLength(1);
  });

  it('comando desconocido responde con ayuda', async () => {
    await handler.handleMessage(msg('/volar alto', MEMBER));
    expect(lastReply()).toContain('Comando desconocido');
  });

  it('un error interno del comando reacciona ❌ y no rompe el handler', async () => {
    const registry = buildCommandRegistry();
    registry.register({
      name: 'explota',
      description: 'test',
      usage: '/explota',
      permission: 'EVERYONE',
      execute: async () => {
        throw new Error('boom');
      },
    });
    const h = new CommandHandler(fakeClient, registry, { reminders, groups });
    await h.handleMessage(msg('/explota', MEMBER));
    expect(lastReaction()).toBe('❌');
    expect(lastReply()).toContain('error interno');
    // El handler sigue operativo después del error
    await h.handleMessage(msg('/recordatorio mañana 10:00 Sigue vivo', MEMBER));
    expect(reminders.listPendingByGroup(GROUP)).toHaveLength(1);
  });

  it('cuenta métricas de comandos procesados y fallidos', async () => {
    await handler.handleMessage(msg('/recordatorio mañana 10:00 A', MEMBER));
    await handler.handleMessage(msg('/recordatorio mañana 10:00 B', MEMBER));
    expect(handler.getMetrics().commandsProcessed).toBe(2);
    expect(handler.getMetrics().commandsFailed).toBe(0);
  });
});
