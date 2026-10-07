import { fromZonedTime } from 'date-fns-tz';
import { extractMentionDigits } from './mentions.js';

/**
 * Parser de fecha/hora para el comando /recordatorio.
 *
 * Formatos soportados (la hora siempre es HH:mm en la zona horaria del bot):
 *   hoy 21:00 ... / mañana 18:30 ... / pasado mañana 07:15 ...
 *   25/09/2026 08:00 ...  (también dd/mm/aa y dd-mm-aaaa)
 *   en 30 minutos ...     (minuto(s)/min, hora(s)/h, día(s)/d)
 *
 * Regla: si la fecha/hora resultante ya pasó, se rechaza con error explícito.
 */

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

export interface ParsedReminderInput {
  scheduledAt: Date;
  message: string;
  mentions: string[];
}

/** Extract mentioned user JIDs from the message, preserving message text untouched. */
export function extractMentions(message: string): string[] {
  return extractMentionDigits(message).map((digits) => `${digits}@s.whatsapp.net`);
}

const TIME_REGEX = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const DATE_REGEX = /^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2}|\d{4})$/;
const RELATIVE_REGEX = /^(\d+)\s*(min(?:uto)?s?|h(?:oras?)?|d(?:ías?|ias?)?)$/i;

const USAGE =
  'Formato: /recordatorio <hoy|mañana|dd/mm/aaaa|en N minutos/horas/días> <HH:mm> <mensaje>';

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function zonedDate(
  timezone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const pad = (n: number) => String(n).padStart(2, '0');
  return fromZonedTime(`${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00`, timezone);
}

/** Suma días de calendario según la zona horaria indicada. */
function addZonedDays(base: Date, days: number, timezone: string): Date {
  if (days === 0) return base;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(base);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  // Representación local tratada como UTC para sumar días de calendario exactos.
  const localAsUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return fromZonedTime(new Date(localAsUtc + days * 86_400_000), timezone);
}

function zonedDayParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  return { get: (type: string) => Number(parts.find((p) => p.type === type)?.value) };
}

export function parseReminderInput(
  rawArgs: string,
  timezone: string,
  now: Date = new Date(),
): ParsedReminderInput {
  const tokens = rawArgs.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) {
    throw new ParseError(`Faltan datos. ${USAGE}`);
  }

  let scheduledAt: Date;
  let consumed: number;

  const firstRaw = tokens[0] ?? '';
  const first = normalize(firstRaw);

  if (first === 'en') {
    // Formato relativo: /recordatorio en 30 minutos Reunión
    const match = RELATIVE_REGEX.exec(`${tokens[1] ?? ''} ${tokens[2] ?? ''}`);
    if (!match) {
      throw new ParseError(`No entendí el tiempo relativo. ${USAGE}`);
    }
    const amount = Number(match[1]);
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 100_000) {
      throw new ParseError('La cantidad de tiempo debe ser un entero entre 1 y 100000.');
    }
    const unit = normalize(match[2] ?? '');
    const ms = unit.startsWith('min')
      ? amount * 60_000
      : unit.startsWith('h')
        ? amount * 3_600_000
        : amount * 86_400_000;
    scheduledAt = new Date(now.getTime() + ms);
    consumed = 3;
  } else if (['hoy', 'manana', 'pasado'].includes(first)) {
    const dayOffset = first === 'hoy' ? 0 : first === 'manana' ? 1 : -1;
    const isPasadoManana =
      first === 'pasado' && normalize(tokens[1] ?? '') === 'manana';
    if (dayOffset === -1 && !isPasadoManana) {
      throw new ParseError('¿Quisiste decir "pasado mañana"?');
    }
    const offset = isPasadoManana ? 2 : dayOffset;
    const timeToken = tokens[offset === 2 ? 2 : 1] ?? '';
    const timeMatch = TIME_REGEX.exec(timeToken);
    if (!timeMatch) {
      throw new ParseError(`Hora inválida "${timeToken}". Usa HH:mm (ej: 18:30).`);
    }
    const targetDay = addZonedDays(now, offset, timezone);
    const { get } = zonedDayParts(targetDay, timezone);
    scheduledAt = zonedDate(
      timezone,
      get('year'),
      get('month'),
      get('day'),
      Number(timeMatch[1]),
      Number(timeMatch[2]),
    );
    if (scheduledAt.getTime() <= now.getTime()) {
      throw new ParseError('Esa fecha/hora ya pasó. Indica una hora futura.');
    }
    consumed = offset === 2 ? 3 : 2;
  } else {
    // Formato absoluto: /recordatorio 25/09/2026 08:00 Pagar internet
    const dateMatch = DATE_REGEX.exec(firstRaw);
    if (!dateMatch) {
      throw new ParseError(`No entendí la fecha "${firstRaw}". ${USAGE}`);
    }
    const timeToken = tokens[1] ?? '';
    const timeMatch = TIME_REGEX.exec(timeToken);
    if (!timeMatch) {
      throw new ParseError(`Hora inválida "${timeToken}". Usa HH:mm (ej: 08:00).`);
    }
    let year = Number(dateMatch[3]);
    if (year < 100) year += 2000;
    const month = Number(dateMatch[2]);
    const day = Number(dateMatch[1]);
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      throw new ParseError(`Fecha inválida "${firstRaw}".`);
    }
    // Validar que la fecha exista en el calendario (rechaza 31/02, 29/02 en
    // años no bisiestos, etc.) antes de pasar por conversiones de zona horaria.
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (day > daysInMonth) {
      throw new ParseError(`La fecha "${firstRaw}" no existe en el calendario.`);
    }
    scheduledAt = zonedDate(timezone, year, month, day, Number(timeMatch[1]), Number(timeMatch[2]));
    if (scheduledAt.getTime() <= now.getTime()) {
      throw new ParseError('Esa fecha/hora ya pasó. Indica una fecha futura.');
    }
    consumed = 2;
  }

  const message = tokens.slice(consumed).join(' ').trim();
  if (!message) {
    throw new ParseError('Falta el mensaje del recordatorio.');
  }
  return { scheduledAt, message, mentions: extractMentions(message) };
}
