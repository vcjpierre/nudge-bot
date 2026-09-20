import { describe, expect, it } from 'vitest';
import { ParseError, parseReminderInput } from '../src/reminders/parser.js';

const TZ = 'America/La_Paz';
// 20/09/2026 12:00 en La Paz (UTC-4) = 16:00 UTC
const NOW = new Date('2026-09-20T16:00:00.000Z');

describe('parseReminderInput', () => {
  it('parsea "hoy HH:mm" con hora futura', () => {
    const r = parseReminderInput('hoy 21:00 Sacar la basura', TZ, NOW);
    expect(r.scheduledAt.toISOString()).toBe('2026-09-21T01:00:00.000Z'); // 21:00 -04:00
    expect(r.message).toBe('Sacar la basura');
  });

  it('rechaza "hoy" con hora ya pasada', () => {
    expect(() => parseReminderInput('hoy 08:00 Algo', TZ, NOW)).toThrow(ParseError);
  });

  it('parsea "mañana" con y sin tilde', () => {
    const r1 = parseReminderInput('mañana 18:30 Comprar pan', TZ, NOW);
    const r2 = parseReminderInput('manana 18:30 Comprar pan', TZ, NOW);
    expect(r1.scheduledAt.toISOString()).toBe('2026-09-21T22:30:00.000Z');
    expect(r2.scheduledAt.toISOString()).toBe('2026-09-21T22:30:00.000Z');
  });

  it('parsea "pasado mañana"', () => {
    const r = parseReminderInput('pasado mañana 07:15 Ejercicio', TZ, NOW);
    expect(r.scheduledAt.toISOString()).toBe('2026-09-22T11:15:00.000Z');
  });

  it('rechaza "pasado" sin "mañana"', () => {
    expect(() => parseReminderInput('pasado 10:00 X', TZ, NOW)).toThrow(/pasado mañana/);
  });

  it('parsea fecha absoluta dd/mm/aaaa', () => {
    const r = parseReminderInput('25/09/2026 08:00 Pagar internet', TZ, NOW);
    expect(r.scheduledAt.toISOString()).toBe('2026-09-25T12:00:00.000Z');
    expect(r.message).toBe('Pagar internet');
  });

  it('acepta año corto y guiones', () => {
    const r = parseReminderInput('25-09-26 08:00 Pago', TZ, NOW);
    expect(r.scheduledAt.toISOString()).toBe('2026-09-25T12:00:00.000Z');
  });

  it('rechaza fechas pasadas absolutas', () => {
    expect(() => parseReminderInput('01/01/2020 08:00 Tarde', TZ, NOW)).toThrow(ParseError);
  });

  it('rechaza fechas inexistentes (31/02)', () => {
    expect(() => parseReminderInput('31/02/2027 08:00 Imposible', TZ, NOW)).toThrow(/no existe/);
  });

  it('parsea "en N minutos"', () => {
    const r = parseReminderInput('en 30 minutos Llamar a mamá', TZ, NOW);
    expect(r.scheduledAt.getTime()).toBe(NOW.getTime() + 30 * 60_000);
    expect(r.message).toBe('Llamar a mamá');
  });

  it('parsea "en 2 horas" y "en 1 día"', () => {
    expect(parseReminderInput('en 2 horas X', TZ, NOW).scheduledAt.getTime()).toBe(
      NOW.getTime() + 2 * 3_600_000,
    );
    expect(parseReminderInput('en 1 día X', TZ, NOW).scheduledAt.getTime()).toBe(
      NOW.getTime() + 86_400_000,
    );
  });

  it('rechaza horas inválidas', () => {
    expect(() => parseReminderInput('mañana 25:00 X', TZ, NOW)).toThrow(/Hora inválida/);
    expect(() => parseReminderInput('mañana 18:99 X', TZ, NOW)).toThrow(/Hora inválida/);
  });

  it('rechaza input sin mensaje', () => {
    expect(() => parseReminderInput('mañana 18:00', TZ, NOW)).toThrow(/mensaje/);
  });

  it('rechaza input vacío', () => {
    expect(() => parseReminderInput('', TZ, NOW)).toThrow(ParseError);
    expect(() => parseReminderInput('   ', TZ, NOW)).toThrow(ParseError);
  });

  it('rechaza fechas ininteligibles', () => {
    expect(() => parseReminderInput('ayer 10:00 X', TZ, NOW)).toThrow(ParseError);
    expect(() => parseReminderInput('blabla 10:00 X', TZ, NOW)).toThrow(ParseError);
  });

  it('conserva mayúsculas y espacios internos del mensaje', () => {
    const r = parseReminderInput('mañana 06:00 Comprar Comida para el PERRO', TZ, NOW);
    expect(r.message).toBe('Comprar Comida para el PERRO');
  });

  it('"en 0 minutos" es inválido', () => {
    expect(() => parseReminderInput('en 0 minutos X', TZ, NOW)).toThrow(ParseError);
  });
});
