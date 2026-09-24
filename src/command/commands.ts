import type { CommandCatalog, GroupCatalog } from "./model.js";

/** Preserve command IDs, routes, fields, and schemas as literals. */
export function defineCommands<const Catalog extends CommandCatalog>(commands: Catalog): Catalog {
  return commands;
}

/** Preserve route group IDs, routes, and presentation content as literals. */
export function defineGroups<const Catalog extends GroupCatalog>(groups: Catalog): Catalog {
  return groups;
}
