import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GroupMetadata } from 'baileys';
import { createTestDb, type Db } from '../src/db/index.js';
import type { Reminder } from '../src/db/schema.js';
import { reminderCommand } from '../src/commands/reminder.js';
import type { CommandContext } from '../src/commands/types.js';
import { GroupService } from '../src/groups/service.js';
import {
  extractMentionDigits,
  resolveGroupMentions,
  stripMentionTokens,
  type MentionRef,
} from '../src/reminders/mentions.js';
import { extractMentions, parseReminderInput } from '../src/reminders/parser.js';
import {
  buildDeliveryText,
  ReminderScheduler,
  type ReminderSender,
} from '../src/reminders/scheduler.js';
import {
  ReminderService,
  mentionsHaveLabels,
  parseMentionRefs,
  parseMentions,
  serializeMentions,
} from '../src/reminders/service.js';

const TZ = 'America/La_Paz';
// 20/09/2026 12:00 en La Paz (UTC-4) = 16:00 UTC
const NOW = new Date('2026-09-20T16:00:00.000Z');

describe('extractMentions', () => {
  it('extrae una mención con código de país', () => {
    expect(extractMentions('@59112345678 Sacar la basura')).toEqual([
      '59112345678@s.whatsapp.net',
    ]);
  });

  it('extrae múltiples menciones en cualquier parte del mensaje', () => {
    expect(
      extractMentions('Hola @59111111111 y @5492222222222, reunión hoy'),
    ).toEqual(['59111111111@s.whatsapp.net', '5492222222222@s.whatsapp.net']);
  });

  it('devuelve array vacío si no hay menciones', () => {
    expect(extractMentions('Sacar la basura')).toEqual([]);
  });

  it('ignora @ inválidos: sin dígitos, muy cortos o muy largos', () => {
    expect(extractMentions('@abc hola')).toEqual([]);
    expect(extractMentions('llama al 123 amigo')).toEqual([]);
    expect(extractMentions('hola @123 chao')).toEqual([]);
    expect(extractMentions('hola @1234567 chao')).toEqual([]);
    expect(extractMentions('hola @1234567890123456 chao')).toEqual([]);
  });

  it('dedupes repeated mentions', () => {
    expect(extractMentions('@59111111111 y otra vez @59111111111')).toEqual([
      '59111111111@s.whatsapp.net',
    ]);
  });
});

describe('parseReminderInput with mentions', () => {
  it('devuelve mentions junto al mensaje y conserva el @texto', () => {
    const r = parseReminderInput('hoy 18:00 @59112345678 Hola', TZ, NOW);
    expect(r.mentions).toEqual(['59112345678@s.whatsapp.net']);
    expect(r.message).toBe('@59112345678 Hola');
  });

  it('devuelve array vacío cuando no hay @', () => {
    const r = parseReminderInput('hoy 18:00 Sacar la basura', TZ, NOW);
    expect(r.mentions).toEqual([]);
    expect(r.message).toBe('Sacar la basura');
  });
});

describe('mentions serialization', () => {
  it('serializeMentions devuelve null para array vacío o ausente', () => {
    expect(serializeMentions()).toBeNull();
    expect(serializeMentions([])).toBeNull();
  });

  it('roundtrip serialize/parse', () => {
    const jids = ['59111111111@s.whatsapp.net'];
    expect(parseMentions(serializeMentions(jids))).toEqual(jids);
  });

  it('parseMentions nunca lanza: null o JSON roto devuelven []', () => {
    expect(parseMentions(null)).toEqual([]);
    expect(parseMentions('not-json')).toEqual([]);
    expect(parseMentions('{"a":1}')).toEqual([]);
  });
});

describe('ReminderService with mentions', () => {
  let db: Db;
  let reminders: ReminderService;

  beforeEach(() => {
    db = createTestDb();
    reminders = new ReminderService(db);
  });

  afterEach(() => {
    db.$client.close();
  });

  const base = {
    groupJid: '123@g.us',
    creatorJid: '59111111111@s.whatsapp.net',
    creatorName: 'Juan',
    message: '@59112345678 Hola',
  };

  it('guarda mentions al crear', () => {
    const r = reminders.create({
      ...base,
      scheduledAt: new Date(Date.now() + 60_000),
      mentions: ['59112345678@s.whatsapp.net'],
    });
    expect(parseMentions(r.mentions)).toEqual(['59112345678@s.whatsapp.net']);
  });

  it('mentions es null cuando no se pasan', () => {
    const r = reminders.create({ ...base, scheduledAt: new Date(Date.now() + 60_000) });
    expect(r.mentions).toBeNull();
  });
});

describe('ReminderScheduler with mentions', () => {
  let db: Db;
  let reminders: ReminderService;
  let groups: GroupService;
  let sender: ReminderSender & { sendToGroup: ReturnType<typeof vi.fn> };
  let scheduler: ReminderScheduler;

  beforeEach(() => {
    db = createTestDb();
    reminders = new ReminderService(db);
    groups = new GroupService(db);
    groups.authorize('123@g.us', 'Grupo Test');
    sender = { sendToGroup: vi.fn().mockResolvedValue(undefined) };
    scheduler = new ReminderScheduler(reminders, groups, sender);
  });

  afterEach(() => {
    scheduler.stop();
    db.$client.close();
  });

  const base = {
    groupJid: '123@g.us',
    creatorJid: '59111111111@s.whatsapp.net',
    creatorName: 'Juan',
  };

  it('pasa creatorJid + mentions guardados a sendToGroup', async () => {
    reminders.create({
      ...base,
      message: '@59112345678 Hola',
      scheduledAt: new Date(Date.now() - 1000),
      mentions: ['59112345678@s.whatsapp.net'],
    });
    await scheduler.tick();
    expect(sender.sendToGroup).toHaveBeenCalledTimes(1);
    expect(sender.sendToGroup.mock.calls[0]?.[2]).toEqual([
      '59111111111@s.whatsapp.net',
      '59112345678@s.whatsapp.net',
    ]);
  });

  it('sin mentions envía solo creatorJid (flujo actual intacto)', async () => {
    reminders.create({
      ...base,
      message: 'Sin menciones',
      scheduledAt: new Date(Date.now() - 1000),
    });
    await scheduler.tick();
    expect(sender.sendToGroup).toHaveBeenCalledTimes(1);
    expect(sender.sendToGroup.mock.calls[0]?.[2]).toEqual([
      '59111111111@s.whatsapp.net',
    ]);
  });
});

describe('mention tokens (digits/strip/resolve)', () => {
  it('extractMentionDigits devuelve dígitos en orden y sin duplicados', () => {
    expect(extractMentionDigits('Hola @59111111111 y @5492222222222')).toEqual([
      '59111111111',
      '5492222222222',
    ]);
    expect(extractMentionDigits('@59111111111 otra vez @59111111111')).toEqual([
      '59111111111',
    ]);
    expect(extractMentionDigits('sin menciones')).toEqual([]);
  });

  it('stripMentionTokens quita los @dígitos y colapsa espacios', () => {
    expect(stripMentionTokens('@59111111111 Sacar la basura')).toBe('Sacar la basura');
    expect(stripMentionTokens('Hola @59111111111 y @5492222222222, reunión')).toBe(
      'Hola y , reunión',
    );
    expect(stripMentionTokens('@59111111111')).toBe('');
  });
});

describe('resolveGroupMentions', () => {
  it('resuelve por JID PN exacto en grupos modo pn', () => {
    const { resolved, ignored } = resolveGroupMentions(['59111111111'], [
      { id: '59111111111@s.whatsapp.net', jid: '59111111111@s.whatsapp.net' },
    ]);
    expect(resolved).toEqual([{ jid: '59111111111@s.whatsapp.net', label: '@59111111111' }]);
    expect(ignored).toEqual([]);
  });

  it('resuelve al id REAL en grupos LID y usa el notify como label', () => {
    const { resolved, ignored } = resolveGroupMentions(['59111111111'], [
      {
        id: '12106123456789@lid',
        jid: '59111111111@s.whatsapp.net',
        lid: '12106123456789@lid',
        notify: 'Juan',
      },
    ]);
    expect(resolved).toEqual([{ jid: '12106123456789@lid', label: '@Juan' }]);
    expect(ignored).toEqual([]);
  });

  it('ignora números fuera del grupo y deduplica', () => {
    const { resolved, ignored } = resolveGroupMentions(
      ['59111111111', '59199999999', '59111111111'],
      [{ id: '59111111111@s.whatsapp.net', jid: '59111111111@s.whatsapp.net' }],
    );
    expect(resolved).toHaveLength(1);
    expect(ignored).toEqual(['59199999999']);
  });
});

describe('mention storage (refs + backward-compat)', () => {
  it('serialize/parse roundtrip con MentionRef', () => {
    const refs: MentionRef[] = [{ jid: '12106123456789@lid', label: '@Juan' }];
    const raw = serializeMentions(refs);
    expect(raw).toBe(JSON.stringify(refs));
    expect(parseMentionRefs(raw)).toEqual(refs);
    expect(parseMentions(raw)).toEqual(['12106123456789@lid']);
  });

  it('string[] conserva el formato JSON legacy', () => {
    expect(serializeMentions(['59111111111@s.whatsapp.net'])).toBe(
      '["59111111111@s.whatsapp.net"]',
    );
  });

  it('parseMentionRefs lee el formato legacy con labels derivados', () => {
    expect(parseMentionRefs('["59111111111@s.whatsapp.net"]')).toEqual([
      { jid: '59111111111@s.whatsapp.net', label: '@59111111111' },
    ]);
  });

  it('mentionsHaveLabels distingue formato nuevo del legacy', () => {
    expect(mentionsHaveLabels(null)).toBe(false);
    expect(mentionsHaveLabels('["59111111111@s.whatsapp.net"]')).toBe(false);
    expect(
      mentionsHaveLabels('[{"jid":"12106123456789@lid","label":"@Juan"}]'),
    ).toBe(true);
  });
});

describe('buildDeliveryText', () => {
  let db: Db;
  let reminders: ReminderService;

  beforeEach(() => {
    db = createTestDb();
    reminders = new ReminderService(db);
  });

  afterEach(() => {
    db.$client.close();
  });

  function seed(message: string, mentions?: Array<string | MentionRef>): Reminder {
    return reminders.create({
      groupJid: '123@g.us',
      creatorJid: '59100000000@s.whatsapp.net',
      creatorName: 'Creador',
      message,
      scheduledAt: new Date(Date.now() - 1000),
      ...(mentions ? { mentions } : {}),
    });
  }

  it('con menciones etiquetadas: texto con labels y JIDs en orden posicional', () => {
    const row = seed('Sacar la basura', [
      { jid: '12106123456789@lid', label: '@Juan' },
      { jid: '59122222222@s.whatsapp.net', label: '@59122222222' },
    ]);
    expect(buildDeliveryText(row)).toEqual({
      text: '⏰ Recordatorio para @Juan, @59122222222: Sacar la basura',
      mentions: [
        '12106123456789@lid',
        '59122222222@s.whatsapp.net',
        '59100000000@s.whatsapp.net',
      ],
    });
  });

  it('legacy sin labels: formato actual intacto', () => {
    const row = seed('@59112345678 Hola', ['59112345678@s.whatsapp.net']);
    expect(buildDeliveryText(row)).toEqual({
      text: '⏰ Recordatorio para Creador: @59112345678 Hola',
      mentions: ['59100000000@s.whatsapp.net', '59112345678@s.whatsapp.net'],
    });
  });

  it('sin menciones: formato actual intacto', () => {
    const row = seed('Sacar la basura');
    expect(buildDeliveryText(row)).toEqual({
      text: '⏰ Recordatorio para Creador: Sacar la basura',
      mentions: ['59100000000@s.whatsapp.net'],
    });
  });
});

describe('reminderCommand with mentions (T6)', () => {
  let db: Db;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.$client.close();
  });

  function makeCtx(args: string, metadata: GroupMetadata | null) {
    const replies: string[] = [];
    const reactions: string[] = [];
    const reminders = new ReminderService(db);
    const groups = new GroupService(db);
    const ctx = {
      groupJid: '123@g.us',
      senderJid: '59100000000@s.whatsapp.net',
      pushName: 'Creador',
      args,
      tokens: args.split(/\s+/),
      services: { reminders, groups },
      reply: async (text: string) => {
        replies.push(text);
      },
      react: async (emoji: string) => {
        reactions.push(emoji);
      },
      timezone: TZ,
      groupMetadata: null,
      fetchGroupMetadata: async () => metadata,
      handler: {},
      registry: {},
    } as unknown as CommandContext;
    return { ctx, replies, reactions, reminders };
  }

  function lidMetadata(): GroupMetadata {
    return {
      id: '123@g.us',
      addressingMode: 'lid',
      subject: 'Grupo Test',
      participants: [
        {
          id: '12106123456789@lid',
          jid: '59111111111@s.whatsapp.net',
          lid: '12106123456789@lid',
          notify: 'Juan',
        },
      ],
    } as unknown as GroupMetadata;
  }

  it('resuelve @dígitos al id LID, guarda cuerpo limpio y avisa con formato nuevo', async () => {
    const { ctx, replies, reactions, reminders } = makeCtx(
      '25/12/2030 08:00 @59111111111 Sacar la basura',
      lidMetadata(),
    );
    await reminderCommand.execute(ctx);
    expect(reactions).toEqual(['✅']);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatch(/^✅ Recordatorio #\d+ guardado/);
    const [row] = reminders.listPendingByGroup('123@g.us');
    expect(row?.message).toBe('Sacar la basura');
    expect(parseMentionRefs(row?.mentions ?? null)).toEqual([
      { jid: '12106123456789@lid', label: '@Juan' },
    ]);
  });

  it('advierte números fuera del grupo y los excluye', async () => {
    const { ctx, replies, reminders } = makeCtx(
      '25/12/2030 08:00 @59111111111 @59199999999 Hola',
      lidMetadata(),
    );
    await reminderCommand.execute(ctx);
    expect(replies[0]).toContain('@59199999999');
    const [row] = reminders.listPendingByGroup('123@g.us');
    expect(row?.message).toBe('Hola');
    expect(parseMentions(row?.mentions ?? null)).toEqual(['12106123456789@lid']);
  });

  it('rechaza cuerpo con solo menciones', async () => {
    const { ctx, replies, reactions, reminders } = makeCtx(
      '25/12/2030 08:00 @59111111111',
      lidMetadata(),
    );
    await reminderCommand.execute(ctx);
    expect(reactions).toEqual(['❌']);
    expect(replies[0]).toMatch(/solo menciones/);
    expect(reminders.listPendingByGroup('123@g.us')).toHaveLength(0);
  });

  it('sin metadata conserva el comportamiento legacy (cuerpo y JIDs PN intactos)', async () => {
    const { ctx, reminders } = makeCtx('25/12/2030 08:00 @59111111111 Hola', null);
    await reminderCommand.execute(ctx);
    const [row] = reminders.listPendingByGroup('123@g.us');
    expect(row?.message).toBe('@59111111111 Hola');
    expect(parseMentions(row?.mentions ?? null)).toEqual(['59111111111@s.whatsapp.net']);
  });

  it('scheduler envía el formato nuevo con mención LID resaltable', async () => {
    const localDb = db;
    const svc = new ReminderService(localDb);
    const groups = new GroupService(localDb);
    groups.authorize('123@g.us', 'Grupo Test');
    const sender = { sendToGroup: vi.fn().mockResolvedValue(undefined) };
    const scheduler = new ReminderScheduler(svc, groups, sender);
    try {
      svc.create({
        groupJid: '123@g.us',
        creatorJid: '59100000000@s.whatsapp.net',
        creatorName: 'Creador',
        message: 'Sacar la basura',
        scheduledAt: new Date(Date.now() - 1000),
        mentions: [{ jid: '12106123456789@lid', label: '@Juan' }],
      });
      await scheduler.tick();
      expect(sender.sendToGroup).toHaveBeenCalledTimes(1);
      expect(sender.sendToGroup.mock.calls[0]?.[1]).toBe(
        '⏰ Recordatorio para @Juan: Sacar la basura',
      );
      expect(sender.sendToGroup.mock.calls[0]?.[2]).toEqual([
        '12106123456789@lid',
        '59100000000@s.whatsapp.net',
      ]);
    } finally {
      scheduler.stop();
    }
  });
});
