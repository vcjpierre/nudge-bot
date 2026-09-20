/**
 * Utilidades para trabajar con identificadores de WhatsApp (JID).
 *
 * Formatos relevantes:
 *  - Usuario por número:  "59171234567@s.whatsapp.net"
 *  - Usuario por LID:     "12345678901234@lid"  (identidad opaca de WhatsApp)
 *  - Grupo:               "120363012345678901@g.us"
 *
 * Nota: un JID puede incluir un sufijo de dispositivo "59171234567:12@s.whatsapp.net".
 */

export function isGroupJid(jid: string): boolean {
  return jid.endsWith('@g.us');
}

/** Extrae el número de teléfono (solo dígitos) de un JID de tipo número, o null si es LID/otro. */
export function jidToPhone(jid: string): string | null {
  if (!jid.endsWith('@s.whatsapp.net')) return null;
  const local = jid.slice(0, jid.indexOf('@'));
  const phone = local.split(':')[0] ?? '';
  return /^\d+$/.test(phone) ? phone : null;
}

/** Convierte un número de teléfono (con o sin "+") a su JID de WhatsApp. */
export function phoneToJid(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return `${digits}@s.whatsapp.net`;
}

/** Normaliza un JID quitando el sufijo de dispositivo (":12"). */
export function normalizeJid(jid: string): string {
  const atIndex = jid.indexOf('@');
  if (atIndex === -1) return jid;
  const local = jid.slice(0, atIndex).split(':')[0] ?? '';
  return `${local}@${jid.slice(atIndex + 1)}`;
}

/** Mismo usuario si coincide JID exacto o el número de teléfono derivado. */
export function sameUser(a: string, b: string): boolean {
  const na = normalizeJid(a);
  const nb = normalizeJid(b);
  if (na === nb) return true;
  const pa = jidToPhone(na);
  const pb = jidToPhone(nb);
  return pa !== null && pb !== null && pa === pb;
}
