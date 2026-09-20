import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv({ quiet: true });

const digitsOnly = (value: string) => value.replace(/\D/g, '');

/** Acepta vacío/placeholder (devuelve undefined) o un número válido de 8-15 dígitos. */
const optionalPhone = z
  .string()
  .optional()
  .transform((v) => {
    if (!v) return undefined;
    const digits = digitsOnly(v);
    // Si el valor original tiene letras (placeholder tipo 591YYYYYYYY), se ignora.
    if (digits.length < 8 || /[a-zA-Z]/.test(v)) return undefined;
    return digits;
  })
  .pipe(
    z
      .string()
      .regex(/^\d{8,15}$/, 'debe tener entre 8 y 15 dígitos (o dejarse vacío)')
      .optional(),
  );

const envSchema = z.object({
  BOT_OWNER_NUMBER: z
    .string()
    .transform(digitsOnly)
    .pipe(z.string().regex(/^\d{8,15}$/, 'BOT_OWNER_NUMBER debe tener entre 8 y 15 dígitos')),
  BOT_OWNER_JID: z
    .string()
    .regex(/^\d+@(s\.whatsapp\.net|lid)$/, 'BOT_OWNER_JID debe ser un JID válido')
    .optional(),
  PHONE_NUMBER: optionalPhone,
  TIMEZONE: z.string().default('America/La_Paz'),
  DATABASE_PATH: z.string().default('./data/bot.db'),
  AUTH_DIR: z.string().default('./auth'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Variables de entorno inválidas:\n${issues}`);
  }
  // Validar que la zona horaria sea reconocida por el runtime (ICU completo en Node 22).
  try {
    new Intl.DateTimeFormat('es-BO', { timeZone: result.data.TIMEZONE });
  } catch {
    throw new Error(`TIMEZONE "${result.data.TIMEZONE}" no es una zona horaria IANA válida`);
  }
  return result.data;
}

export const env: Env = loadEnv();
