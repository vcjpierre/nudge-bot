import type { GroupMetadata, GroupParticipant } from 'baileys';
import { normalizeJid, jidToPhone, phoneToJid } from '../utils/jid.js';

export type PermissionLevel = 'EVERYONE' | 'GROUP_ADMIN' | 'BOT_OWNER';

/**
 * Determina si un participante del grupo es administrador real de WhatsApp.
 * Compara por JID exacto y por número de teléfono (los grupos en modo "lid"
 * pueden reportar participantes con @lid mientras el remitente llega como número).
 */
export function isGroupAdmin(
  metadata: GroupMetadata,
  senderJid: string,
  senderPn?: string,
): boolean {
  const senderPhone = jidToPhone(senderJid) ?? (senderPn ? jidToPhone(senderPn) : null);
  const candidateIds = new Set(
    [senderJid, senderPn, ...(senderPhone ? [phoneToJid(senderPhone)] : [])]
      .filter((v): v is string => Boolean(v))
      .map(normalizeJid),
  );

  return metadata.participants.some((p: GroupParticipant) => {
    const isAdmin = p.admin === 'admin' || p.admin === 'superadmin' || p.isAdmin === true || p.isSuperAdmin === true;
    if (!isAdmin) return false;
    // Coincidencia por JID (id o lid del participante) o por número de teléfono
    // (cuando el grupo reporta @lid y el remitente llega como número, o viceversa).
    const participantPhone = jidToPhone(p.id);
    if (participantPhone && senderPhone && participantPhone === senderPhone) return true;
    const pIds = [p.id, p.lid]
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .map(normalizeJid);
    return pIds.some((id) => candidateIds.has(id));
  });
}

export interface OwnerConfig {
  ownerJid: string;
  ownerNumber: string;
}

/** Compara el remitente con el owner configurado (por JID exacto o por número). */
export function isBotOwner(config: OwnerConfig, senderJid: string, senderPn?: string): boolean {
  const candidates = [senderJid, senderPn].filter((v): v is string => Boolean(v)).map(normalizeJid);
  if (candidates.includes(normalizeJid(config.ownerJid))) return true;
  const senderPhone = candidates.map(jidToPhone).find((p): p is string => p !== null);
  return senderPhone === config.ownerNumber;
}

/**
 * Evalúa si el remitente satisface el nivel de permiso requerido.
 * Jerarquía: BOT_OWNER >= GROUP_ADMIN > EVERYONE (el owner puede todo).
 */
export function hasPermission(input: {
  required: PermissionLevel;
  senderJid: string;
  senderPn?: string;
  owner: OwnerConfig;
  groupMetadata?: GroupMetadata;
}): boolean {
  if (input.required === 'EVERYONE') return true;
  if (isBotOwner(input.owner, input.senderJid, input.senderPn)) return true;
  if (input.required === 'BOT_OWNER') return false;
  // GROUP_ADMIN
  if (!input.groupMetadata) return false;
  return isGroupAdmin(input.groupMetadata, input.senderJid, input.senderPn);
}
