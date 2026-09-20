import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type Db } from '../src/db/index.js';
import { GroupService } from '../src/groups/service.js';
import { ReminderService } from '../src/reminders/service.js';

let db: Db;
let reminders: ReminderService;
let groups: GroupService;

beforeEach(() => {
  db = createTestDb();
  reminders = new ReminderService(db);
  groups = new GroupService(db);
});

afterEach(() => {
  db.$client.close();
});

const base = {
  groupJid: '123@g.us',
  creatorJid: '59111111111@s.whatsapp.net',
  creatorName: 'Juan',
  message: 'Comprar pan',
};

describe('ReminderService', () => {
  it('crea y lista recordatorios pendientes del grupo', () => {
    reminders.create({ ...base, scheduledAt: new Date(Date.now() + 60_000) });
    reminders.create({
      ...base,
      groupJid: 'otro@g.us',
      scheduledAt: new Date(Date.now() + 60_000),
    });
    const pending = reminders.listPendingByGroup('123@g.us');
    expect(pending).toHaveLength(1);
    expect(pending[0]?.status).toBe('PENDING');
  });

  it('cancelInGroup cancela solo pendientes del mismo grupo', () => {
    const r = reminders.create({ ...base, scheduledAt: new Date(Date.now() + 60_000) });
    expect(reminders.cancelInGroup(r.id, 'otro@g.us').result).toBe('not-found');
    const cancelled = reminders.cancelInGroup(r.id, '123@g.us');
    expect(cancelled.result).not.toBe('not-pending');
    expect(reminders.getById(r.id)?.status).toBe('CANCELLED');
    // No se puede cancelar dos veces
    expect(reminders.cancelInGroup(r.id, '123@g.us').result).toBe('not-pending');
  });

  it('claimDue solo toma vencidos y una sola vez', () => {
    const past = reminders.create({ ...base, scheduledAt: new Date(Date.now() - 60_000) });
    const future = reminders.create({ ...base, scheduledAt: new Date(Date.now() + 3_600_000) });

    const now = new Date();
    const first = reminders.claimDue(now);
    expect(first.map((r) => r.id)).toEqual([past.id]);

    // Un segundo claim inmediato no lo retoma (claim vigente)
    expect(reminders.claimDue(now)).toHaveLength(0);

    // Futuro cancelado nunca se toma; pasado ya ejecutado tampoco
    reminders.cancelInGroup(future.id, '123@g.us');
    reminders.markExecuted(past.id);
    expect(reminders.claimDue(new Date(Date.now() + 86_400_000))).toHaveLength(0);
  });

  it('claim vencido (instancia muerta) puede retomarse tras el timeout', () => {
    const r = reminders.create({ ...base, scheduledAt: new Date(Date.now() - 60_000) });
    reminders.claimDue(new Date());
    // Simulamos 6 minutos después sin que se completara
    const later = new Date(Date.now() + 6 * 60_000);
    const reclaimed = reminders.claimDue(later);
    expect(reclaimed.map((x) => x.id)).toEqual([r.id]);
  });

  it('markExecuted solo funciona si sigue PENDING (protección anti-duplicados)', () => {
    const r = reminders.create({ ...base, scheduledAt: new Date(Date.now() - 60_000) });
    reminders.claimDue(new Date());
    expect(reminders.markExecuted(r.id)).toBe(true);
    expect(reminders.markExecuted(r.id)).toBe(false); // ya ejecutado
    expect(reminders.getById(r.id)?.executedAt).not.toBeNull();
  });

  it('registerFailure aplica backoff exponencial y libera el claim', () => {
    const r = reminders.create({ ...base, scheduledAt: new Date(Date.now() - 60_000) });
    const now = new Date();
    reminders.claimDue(now);

    reminders.registerFailure(r.id, now);
    let row = reminders.getById(r.id)!;
    expect(row.attempts).toBe(1);
    expect(row.claimedAt).toBeNull();
    expect(row.nextRetryAt!.getTime()).toBe(now.getTime() + 60_000); // 1 min

    // Segundo fallo: 2 minutos
    reminders.claimDue(new Date(now.getTime() + 61_000));
    reminders.registerFailure(r.id, new Date(now.getTime() + 61_000));
    row = reminders.getById(r.id)!;
    expect(row.attempts).toBe(2);
    expect(row.nextRetryAt!.getTime()).toBe(now.getTime() + 61_000 + 120_000);

    // No claimable antes de nextRetryAt
    expect(reminders.claimDue(new Date(now.getTime() + 61_000))).toHaveLength(0);
    // Sí después
    expect(reminders.claimDue(new Date(now.getTime() + 61_000 + 121_000)).map((x) => x.id)).toEqual([r.id]);
  });
});

describe('GroupService', () => {
  it('autoriza, re-autoriza y desautoriza grupos', () => {
    expect(groups.isAuthorized('123@g.us')).toBe(false);
    groups.authorize('123@g.us', 'Mi Grupo');
    expect(groups.isAuthorized('123@g.us')).toBe(true);

    // Re-autorizar actualiza el nombre sin duplicar
    groups.authorize('123@g.us', 'Grupo Renombrado');
    expect(groups.listEnabled()).toHaveLength(1);
    expect(groups.listEnabled()[0]?.name).toBe('Grupo Renombrado');

    expect(groups.deauthorize('123@g.us')).toBe(true);
    expect(groups.isAuthorized('123@g.us')).toBe(false);
    // Desautorizar dos veces sigue funcionando (idempotente)
    expect(groups.deauthorize('123@g.us')).toBe(true);
    expect(groups.deauthorize('inexistente@g.us')).toBe(false);
  });
});
