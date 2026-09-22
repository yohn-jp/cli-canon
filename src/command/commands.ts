import type { CommandCatalog } from "./model.js";

/** Preserve command IDs, routes, fields, and schemas as literals. */
export function defineCommands<const Catalog extends CommandCatalog>(commands: Catalog): Catalog {
  return commands;
}
