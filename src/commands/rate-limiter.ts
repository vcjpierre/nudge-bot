export interface RateLimitResult {
  allowed: boolean;
  /** Solo la primera vez que se excede dentro de la ventana (para responder una vez). */
  firstViolation: boolean;
}

interface Bucket {
  timestamps: number[];
  notified: boolean;
}

/**
 * Rate limiter en memoria (ventana deslizante) por usuario y por grupo.
 * Suficiente para una sola instancia; si en el futuro hay varias, mover a DB/Redis.
 */
export class RateLimiter {
  private readonly perUser = new Map<string, Bucket>();
  private readonly perGroup = new Map<string, Bucket>();

  constructor(
    private readonly userLimit = 10,
    private readonly groupLimit = 30,
    private readonly windowMs = 60_000,
  ) {}

  check(userKey: string, groupKey: string, now = Date.now()): RateLimitResult {
    const user = this.hit(this.perUser, userKey, this.userLimit, now);
    const group = this.hit(this.perGroup, groupKey, this.groupLimit, now);
    const blocked = !user.allowed || !group.allowed;
    return {
      allowed: !blocked,
      firstViolation: blocked && (user.firstViolation || group.firstViolation),
    };
  }

  private hit(
    store: Map<string, Bucket>,
    key: string,
    limit: number,
    now: number,
  ): RateLimitResult {
    let bucket = store.get(key);
    if (!bucket) {
      bucket = { timestamps: [], notified: false };
      store.set(key, bucket);
    }
    bucket.timestamps = bucket.timestamps.filter((ts) => now - ts < this.windowMs);
    if (bucket.timestamps.length < limit) {
      bucket.timestamps.push(now);
      bucket.notified = false;
      return { allowed: true, firstViolation: false };
    }
    const firstViolation = !bucket.notified;
    bucket.notified = true;
    return { allowed: false, firstViolation };
  }
}
