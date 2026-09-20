import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type Db } from '../src/db/index.js';
import { GroupService } from '../src/groups/service.js';
import { ReminderScheduler, type ReminderSender } from '../src/reminders/scheduler.js';
import { ReminderService } from '../src/reminders/service.js';

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

describe('ReminderScheduler', () => {
  it('envía y marca EXECUTED los recordatorios vencidos', async () => {
    reminders.create({ ...base, message: 'Vencido', scheduledAt: new Date(Date.now() - 1000) });
    await scheduler.tick();
    expect(sender.sendToGroup).toHaveBeenCalledTimes(1);
    const text = sender.sendToGroup.mock.calls[0]?.[1] as string;
    expect(text).toContain('⏰ Recordatorio para Juan: Vencido');
    expect(reminders.listPendingByGroup('123@g.us')).toHaveLength(0);
  });

  it('no toca recordatorios futuros', async () => {
    reminders.create({ ...base, message: 'Futuro', scheduledAt: new Date(Date.now() + 3_600_000) });
    await scheduler.tick();
    expect(sender.sendToGroup).not.toHaveBeenCalled();
  });

  it('dos ticks consecutivos no duplican envíos', async () => {
    reminders.create({ ...base, message: 'X', scheduledAt: new Date(Date.now() - 1000) });
    await scheduler.tick();
    await scheduler.tick();
    expect(sender.sendToGroup).toHaveBeenCalledTimes(1);
  });

  it('si el envío falla, registra el fallo y reintenta respetando el backoff', async () => {
    const r = reminders.create({ ...base, message: 'X', scheduledAt: new Date(Date.now() - 1000) });
    sender.sendToGroup.mockRejectedValueOnce(new Error('red caída'));
    await scheduler.tick();
    // Sigue PENDING pero con backoff: un tick inmediato NO reintenta
    expect(reminders.getById(r.id)?.status).toBe('PENDING');
    expect(reminders.getById(r.id)?.attempts).toBe(1);
    await scheduler.tick();
    expect(sender.sendToGroup).toHaveBeenCalledTimes(1);
    // Pasado el backoff (1 min), reintenta y tiene éxito
    await scheduler.tick(new Date(Date.now() + 61_000));
    expect(sender.sendToGroup).toHaveBeenCalledTimes(2);
    expect(reminders.getById(r.id)?.status).toBe('EXECUTED');
  });

  it('descarta recordatorios de grupos desautorizados sin enviar', async () => {
    reminders.create({ ...base, message: 'X', scheduledAt: new Date(Date.now() - 1000) });
    groups.deauthorize('123@g.us');
    await scheduler.tick();
    expect(sender.sendToGroup).not.toHaveBeenCalled();
    expect(reminders.listPendingByGroup('123@g.us')).toHaveLength(0);
  });

  it('un error en un recordatorio no detiene los demás ni el scheduler', async () => {
    reminders.create({ ...base, message: 'Falla', scheduledAt: new Date(Date.now() - 2000) });
    reminders.create({ ...base, message: 'Funciona', scheduledAt: new Date(Date.now() - 1000) });
    sender.sendToGroup
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(undefined);
    await expect(scheduler.tick()).resolves.toBeUndefined();
    expect(sender.sendToGroup).toHaveBeenCalledTimes(2);
    const pendientes = reminders.listPendingByGroup('123@g.us');
    expect(pendientes).toHaveLength(1); // solo el que falló
    expect(pendientes[0]?.message).toBe('Falla');
  });

  it('no envía nada si el recordatorio fue cancelado entre el claim y el envío', async () => {
    // markExecuted devuelve false si ya no está PENDING; aquí simulamos cancelación
    // previa a la ejecución (el scheduler lo reclama, se envía, pero al marcar ya fue cancelado).
    const r = reminders.create({ ...base, message: 'X', scheduledAt: new Date(Date.now() - 1000) });
    sender.sendToGroup.mockImplementationOnce(async () => {
      reminders.cancelInGroup(r.id, '123@g.us');
    });
    await scheduler.tick();
    expect(sender.sendToGroup).toHaveBeenCalledTimes(1);
    expect(reminders.getById(r.id)?.status).toBe('CANCELLED');
    expect(reminders.getById(r.id)?.executedAt).toBeNull();
  });
});
