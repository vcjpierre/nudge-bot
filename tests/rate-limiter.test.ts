import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../src/commands/rate-limiter.js';

describe('RateLimiter', () => {
  it('permite hasta el límite por usuario y luego bloquea', () => {
    const rl = new RateLimiter(3, 100, 60_000);
    const t = 1_000_000;
    expect(rl.check('u1', 'g1', t).allowed).toBe(true);
    expect(rl.check('u1', 'g1', t + 1).allowed).toBe(true);
    expect(rl.check('u1', 'g1', t + 2).allowed).toBe(true);
    const blocked = rl.check('u1', 'g1', t + 3);
    expect(blocked.allowed).toBe(false);
    expect(blocked.firstViolation).toBe(true);
    // La segunda violación consecutiva no se notifica de nuevo
    expect(rl.check('u1', 'g1', t + 4).firstViolation).toBe(false);
  });

  it('se resetea pasada la ventana', () => {
    const rl = new RateLimiter(1, 100, 60_000);
    const t = 1_000_000;
    expect(rl.check('u1', 'g1', t).allowed).toBe(true);
    expect(rl.check('u1', 'g1', t + 1).allowed).toBe(false);
    expect(rl.check('u1', 'g1', t + 61_000).allowed).toBe(true);
  });

  it('limita por grupo independientemente del usuario', () => {
    const rl = new RateLimiter(100, 2, 60_000);
    const t = 1_000_000;
    expect(rl.check('u1', 'g1', t).allowed).toBe(true);
    expect(rl.check('u2', 'g1', t).allowed).toBe(true);
    expect(rl.check('u3', 'g1', t).allowed).toBe(false);
    // Otro grupo no está afectado
    expect(rl.check('u3', 'g2', t).allowed).toBe(true);
  });
});
