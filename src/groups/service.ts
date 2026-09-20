import { eq } from 'drizzle-orm';
import { db as defaultDb, type Db } from '../db/index.js';
import { authorizedGroups, type AuthorizedGroup } from '../db/schema.js';

export class GroupService {
  constructor(private readonly db: Db = defaultDb) {}

  /** true solo si el grupo existe y está habilitado. */
  isAuthorized(jid: string): boolean {
    const row = this.db
      .select({ enabled: authorizedGroups.enabled })
      .from(authorizedGroups)
      .where(eq(authorizedGroups.jid, jid))
      .get();
    return row?.enabled === true;
  }

  /** Autoriza (o re-habilita) un grupo. Devuelve el registro. */
  authorize(jid: string, name: string): AuthorizedGroup {
    const now = new Date();
    const row = this.db
      .insert(authorizedGroups)
      .values({ jid, name, enabled: true, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: authorizedGroups.jid,
        set: { name, enabled: true, updatedAt: now },
      })
      .returning()
      .get();
    return row;
  }

  /** Deshabilita el grupo (soft-delete). Devuelve false si no estaba registrado. */
  deauthorize(jid: string): boolean {
    const result = this.db
      .update(authorizedGroups)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(authorizedGroups.jid, jid))
      .run();
    return result.changes > 0;
  }

  listEnabled(): AuthorizedGroup[] {
    return this.db
      .select()
      .from(authorizedGroups)
      .where(eq(authorizedGroups.enabled, true))
      .all();
  }

  /** Zona horaria del grupo, o null si usa la global del bot. */
  getTimezone(jid: string): string | null {
    const row = this.db
      .select({ timezone: authorizedGroups.timezone })
      .from(authorizedGroups)
      .where(eq(authorizedGroups.jid, jid))
      .get();
    return row?.timezone ?? null;
  }

  /** Configura la zona horaria del grupo. Devuelve false si el grupo no existe. */
  setTimezone(jid: string, timezone: string | null): boolean {
    const result = this.db
      .update(authorizedGroups)
      .set({ timezone, updatedAt: new Date() })
      .where(eq(authorizedGroups.jid, jid))
      .run();
    return result.changes > 0;
  }
}
