import type { CommandCatalog } from "./model.js";

/**
 * Identity-style authoring boundary. Literal command IDs, routes, fields, and
 * schemas must survive inference so no handwritten CommandId union exists.
 */
export declare function defineCommands<const Catalog extends CommandCatalog>(
  commands: Catalog,
): Catalog;
