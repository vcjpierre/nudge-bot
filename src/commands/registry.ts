import type { Command } from './types.js';

/** Registro central de comandos. Sin switch/case: búsqueda por nombre/alias. */
export class CommandRegistry {
  private readonly byName = new Map<string, Command>();
  private readonly commands: Command[] = [];

  register(command: Command): void {
    const names = [command.name, ...(command.aliases ?? [])].map((n) => n.toLowerCase());
    for (const name of names) {
      if (this.byName.has(name)) {
        throw new Error(`Comando duplicado: "${name}"`);
      }
      this.byName.set(name, command);
    }
    this.commands.push(command);
  }

  get(name: string): Command | undefined {
    return this.byName.get(name.toLowerCase());
  }

  all(): readonly Command[] {
    return this.commands;
  }
}
