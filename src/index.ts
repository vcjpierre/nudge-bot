import { buildCommandRegistry, CommandHandler } from './commands/index.js';
import { env } from './config/env.js';
import { closeDb, runMigrations } from './db/index.js';
import { purgeOldProcessedMessages } from './db/message-guard.js';
import { GroupService } from './groups/service.js';
import { startHealthServer } from './health/server.js';
import { ReminderScheduler } from './reminders/scheduler.js';
import { ReminderService } from './reminders/service.js';
import { logger } from './utils/logger.js';
import { WhatsAppClient } from './whatsapp/client.js';

/**
 * Punto de entrada del bot.
 *
 * Orden de arranque: migraciones → servicios → scheduler → WhatsApp → HTTP.
 * Orden de apagado (SIGINT/SIGTERM): HTTP → scheduler → WhatsApp → DB.
 */
async function main(): Promise<void> {
  logger.info({ timezone: env.TIMEZONE }, 'iniciando nudge-bot');

  runMigrations();

  const reminderService = new ReminderService();
  const groupService = new GroupService();
  const client = new WhatsAppClient();

  const scheduler = new ReminderScheduler(reminderService, groupService, {
    sendToGroup: (groupJid, text, mentions) => client.sendText(groupJid, text, mentions),
  });

  const registry = buildCommandRegistry();
  const handler = new CommandHandler(client, registry, {
    reminders: reminderService,
    groups: groupService,
  });

  client.onMessage((msg) => handler.handleMessage(msg));

  scheduler.start();
  purgeOldProcessedMessages();

  // Purga periódica de mensajes procesados (una vez al día).
  const purgeTimer = setInterval(purgeOldProcessedMessages, 24 * 60 * 60 * 1000);
  purgeTimer.unref?.();

  await client.connect();

  const healthServer = startHealthServer({
    isWhatsAppConnected: () => client.isConnected(),
    metrics: () => ({
      pendingReminders: reminderService.countAllPending(),
      authorizedGroups: groupService.listEnabled().length,
      ...handler.getMetrics(),
    }),
  });

  // --- Graceful shutdown ---
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'apagando...');
    scheduler.stop();
    clearInterval(purgeTimer);
    healthServer.close();
    client
      .shutdown()
      .catch((error) => logger.warn({ err: error }, 'error al cerrar WhatsApp'))
      .finally(() => {
        closeDb();
        logger.info('apagado completo');
        process.exit(0);
      });
    // Salvavidas: si algo se cuelga, salir igual.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  logger.fatal({ err: error }, 'error fatal en el arranque');
  process.exit(1);
});
