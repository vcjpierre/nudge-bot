import { serve, type ServerType } from '@hono/node-server';
import { Hono } from 'hono';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export interface HealthDeps {
  isWhatsAppConnected: () => boolean;
  metrics: () => {
    pendingReminders: number;
    authorizedGroups: number;
    commandsProcessed: number;
    commandsFailed: number;
  };
}

/**
 * Servidor HTTP mínimo (Hono) con health check y métricas básicas.
 * Punto de extensión natural para el futuro panel web / API.
 */
export function startHealthServer(deps: HealthDeps): ServerType {
  const app = new Hono();

  app.get('/health', (c) => {
    const whatsapp = deps.isWhatsAppConnected();
    return c.json(
      { status: 'ok', whatsapp, uptime: Math.round(process.uptime()), ...deps.metrics() },
      200,
    );
  });

  const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    logger.info({ port: info.port }, 'servidor HTTP (health) escuchando');
  });
  return server;
}
