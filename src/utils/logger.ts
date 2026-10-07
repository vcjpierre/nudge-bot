import pino from 'pino';
import { env } from '../config/env.js';

const isPretty = process.stdout.isTTY === true;

/**
 * Logger estructurado de la aplicación.
 * Nunca registrar credenciales de WhatsApp ni contenido sensible.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'nudge-bot' },
  ...(isPretty
    ? {
        transport: {
          target: 'pino-pretty',
          options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
        },
      }
    : {}),
});

export type Logger = typeof logger;
