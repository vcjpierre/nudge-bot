import { authorizeGroupCommand } from './authorize-group.js';
import { configCommand } from './config.js';
import { deauthorizeGroupCommand } from './deauthorize-group.js';
import { deleteReminderCommand } from './delete-reminder.js';
import { helpCommand } from './help.js';
import { myJidCommand } from './my-jid.js';
import { CommandRegistry } from './registry.js';
import { reminderCommand } from './reminder.js';
import { listRemindersCommand } from './reminders.js';

/** Registra todos los comandos disponibles. Agregar uno nuevo = una línea aquí. */
export function buildCommandRegistry(): CommandRegistry {
  const registry = new CommandRegistry();
  registry.register(reminderCommand);
  registry.register(listRemindersCommand);
  registry.register(deleteReminderCommand);
  registry.register(configCommand);
  registry.register(helpCommand);
  registry.register(myJidCommand);
  registry.register(authorizeGroupCommand);
  registry.register(deauthorizeGroupCommand);
  return registry;
}

export { CommandRegistry } from './registry.js';
export { CommandHandler } from './handler.js';
export type { Command, CommandContext, Services } from './types.js';
