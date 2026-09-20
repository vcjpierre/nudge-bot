import { describe, expect, it } from 'vitest';
import type { GroupMetadata } from 'baileys';
import {
  hasPermission,
  isBotOwner,
  isGroupAdmin,
} from '../src/whatsapp/permissions.js';

const owner = { ownerJid: '59170000001@s.whatsapp.net', ownerNumber: '59170000001' };

function makeMetadata(participants: Array<Partial<GroupMetadata['participants'][number]>>): GroupMetadata {
  return {
    id: '123@g.us',
    subject: 'Test',
    participants: participants as GroupMetadata['participants'],
  } as GroupMetadata;
}

describe('isGroupAdmin', () => {
  const metadata = makeMetadata([
    { id: '59111111111@s.whatsapp.net', admin: 'admin' },
    { id: '59222222222@s.whatsapp.net', admin: 'superadmin' },
    { id: '59333333333@s.whatsapp.net', admin: null },
    { id: '999888777@lid', admin: 'admin', phoneNumber: '59444444444@s.whatsapp.net' },
  ]);

  it('detecta admin por JID', () => {
    expect(isGroupAdmin(metadata, '59111111111@s.whatsapp.net')).toBe(true);
  });

  it('detecta superadmin', () => {
    expect(isGroupAdmin(metadata, '59222222222@s.whatsapp.net')).toBe(true);
  });

  it('rechaza miembros normales', () => {
    expect(isGroupAdmin(metadata, '59333333333@s.whatsapp.net')).toBe(false);
    expect(isGroupAdmin(metadata, '59999999999@s.whatsapp.net')).toBe(false);
  });

  it('reconoce admin aunque el remitente llegue con sufijo de dispositivo', () => {
    expect(isGroupAdmin(metadata, '59111111111:3@s.whatsapp.net')).toBe(true);
  });

  it('reconoce admin cuando el participante está como LID y el remitente llega con ese LID', () => {
    // El remitente llega con el mismo @lid que aparece en la metadata.
    expect(isGroupAdmin(metadata, '999888777@lid')).toBe(true);
  });

  it('reconoce admin cuando el remitente llega como PN y el participante es PN', () => {
    expect(isGroupAdmin(metadata, '59444444444@s.whatsapp.net')).toBe(false); // no está en metadata
    expect(isGroupAdmin(metadata, '59111111111@s.whatsapp.net')).toBe(true);
  });
});

describe('isBotOwner', () => {
  it('coincide por número', () => {
    expect(isBotOwner(owner, '59170000001@s.whatsapp.net')).toBe(true);
  });

  it('coincide por JID exacto (LID configurado)', () => {
    const lidOwner = { ownerJid: '123456789@lid', ownerNumber: '59170000001' };
    expect(isBotOwner(lidOwner, '123456789@lid')).toBe(true);
    expect(isBotOwner(lidOwner, '59170000001@s.whatsapp.net')).toBe(true); // por número
  });

  it('no coincide con otros usuarios', () => {
    expect(isBotOwner(owner, '59170000002@s.whatsapp.net')).toBe(false);
    expect(isBotOwner(owner, '59170000001@lid')).toBe(false); // LID distinto del JID pn
  });

  it('no se deja engañar por números que contienen el del owner', () => {
    expect(isBotOwner(owner, '1591700000012@s.whatsapp.net')).toBe(false);
  });
});

describe('hasPermission', () => {
  const metadata = makeMetadata([{ id: '59111111111@s.whatsapp.net', admin: 'admin' }]);

  it('EVERYONE permite a cualquiera', () => {
    expect(
      hasPermission({ required: 'EVERYONE', senderJid: '59199999999@s.whatsapp.net', owner }),
    ).toBe(true);
  });

  it('GROUP_ADMIN permite a admin y al owner, pero no a miembros', () => {
    expect(
      hasPermission({
        required: 'GROUP_ADMIN',
        senderJid: '59111111111@s.whatsapp.net',
        owner,
        groupMetadata: metadata,
      }),
    ).toBe(true);
    expect(
      hasPermission({
        required: 'GROUP_ADMIN',
        senderJid: '59170000001@s.whatsapp.net',
        owner,
        groupMetadata: metadata,
      }),
    ).toBe(true);
    expect(
      hasPermission({
        required: 'GROUP_ADMIN',
        senderJid: '59199999999@s.whatsapp.net',
        owner,
        groupMetadata: metadata,
      }),
    ).toBe(false);
  });

  it('BOT_OWNER solo permite al owner (ni siquiera a admins)', () => {
    expect(
      hasPermission({ required: 'BOT_OWNER', senderJid: '59170000001@s.whatsapp.net', owner }),
    ).toBe(true);
    expect(
      hasPermission({
        required: 'BOT_OWNER',
        senderJid: '59111111111@s.whatsapp.net',
        owner,
        groupMetadata: metadata,
      }),
    ).toBe(false);
  });

  it('GROUP_ADMIN sin metadata no permite a nadie salvo owner', () => {
    expect(
      hasPermission({
        required: 'GROUP_ADMIN',
        senderJid: '59111111111@s.whatsapp.net',
        owner,
      }),
    ).toBe(false);
  });
});
