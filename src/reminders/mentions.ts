import { jidToPhone, normalizeJid, phoneToJid } from '../utils/jid.js';

/**
 * A resolved user mention: the real routable participant JID plus the `@`
 * label rendered in the delivery text (labels already include the `@`).
 */
export interface MentionRef {
  jid: string;
  label: string;
}

/** Minimal participant shape needed to resolve mentions (subset of Baileys `GroupParticipant`). */
export interface MentionParticipant {
  id: string;
  jid?: string;
  lid?: string;
  notify?: string;
}

/** `@` followed by 8-15 digits with country code (same rule as the parser). */
const MENTION_TOKEN_REGEX = /@(\d{8,15})(?!\d)/g;
const MENTION_STRIP_REGEX = /@\d{8,15}(?!\d)/g;

/** Phone digits of every `@digits` token in the message, in order and deduplicated. */
export function extractMentionDigits(message: string): string[] {
  const digits: string[] = [];
  for (const match of message.matchAll(MENTION_TOKEN_REGEX)) {
    const d = match[1];
    if (!d) continue;
    if (!digits.includes(d)) digits.push(d);
  }
  return digits;
}

/** Remove `@digits` tokens from the body and collapse whitespace. */
export function stripMentionTokens(message: string): string {
  return message.replace(MENTION_STRIP_REGEX, '').replace(/\s+/g, ' ').trim();
}

/**
 * Resolve phone digits against group participants.
 *
 * Each participant is matched by exact PN JID (`id` or `jid` field) or by the
 * phone derived from them; the returned JID is always the participant's REAL
 * `id` (in LID-addressed groups that is `<lid>@lid`, which is what WhatsApp
 * requires in `mentions` for the tag to highlight). Digits with no participant
 * match are reported as `ignored` so the caller can warn the user.
 */
export function resolveGroupMentions(
  digits: string[],
  participants: readonly MentionParticipant[] | null | undefined,
): { resolved: MentionRef[]; ignored: string[] } {
  const resolved: MentionRef[] = [];
  const ignored: string[] = [];
  const seen = new Set<string>();
  const list = participants ?? [];
  for (const d of digits) {
    const participant = findParticipantByPhone(list, d);
    if (!participant) {
      if (!ignored.includes(d)) ignored.push(d);
      continue;
    }
    const jid = normalizeJid(participant.id);
    if (seen.has(jid)) continue;
    seen.add(jid);
    const name = participant.notify?.replace(/\s+/g, ' ').trim().replace(/^@+/, '');
    resolved.push({ jid, label: `@${name && name.length > 0 ? name : d}` });
  }
  return { resolved, ignored };
}

function findParticipantByPhone(
  participants: readonly MentionParticipant[],
  digits: string,
): MentionParticipant | undefined {
  const pnJid = normalizeJid(phoneToJid(digits));
  return participants.find((p) => {
    if (p.id && normalizeJid(p.id) === pnJid) return true;
    if (p.jid && normalizeJid(p.jid) === pnJid) return true;
    const phone = jidToPhone(p.id) ?? (p.jid ? jidToPhone(p.jid) : null);
    return phone === digits;
  });
}
