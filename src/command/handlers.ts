import type * as z from "zod";
import type {
  CommandCatalog,
  CommandDefinition,
  CommandInput,
} from "./model.js";

export type MaybePromise<Value> = Value | Promise<Value>;

export type CommandHandler<Command extends CommandDefinition> = (
  input: CommandInput<Command>,
) => MaybePromise<z.input<Command["result"]>>;

export type HandlerMap<Catalog extends CommandCatalog> = {
  readonly [Id in keyof Catalog]: CommandHandler<Catalog[Id]>;
};

/**
 * Binds one handler to every command in the catalog. The implementation must
 * preserve command-specific input/result types and reject missing/extra IDs.
 */
export declare function bindHandlers<const Catalog extends CommandCatalog>(
  commands: Catalog,
): <const Handlers extends HandlerMap<Catalog>>(handlers: Handlers) => Handlers;
