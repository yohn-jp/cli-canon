import type * as z from "zod";
import type { CommandCatalog, CommandDefinition, CommandInput } from "./model.js";

export type MaybePromise<Value> = Value | Promise<Value>;
export type CommandHandler<Command extends CommandDefinition> = (
  input: CommandInput<Command>,
) => MaybePromise<z.input<Command["result"]>>;

export type HandlerMap<Catalog extends CommandCatalog> = {
  readonly [Id in keyof Catalog]: CommandHandler<Catalog[Id]>;
};

type NoExtraHandlers<Catalog extends CommandCatalog, Handlers> = Handlers &
  Record<Exclude<keyof Handlers, keyof Catalog>, never>;

export function bindHandlers<const Catalog extends CommandCatalog>(_commands: Catalog) {
  return <const Handlers extends HandlerMap<Catalog>>(
    handlers: NoExtraHandlers<Catalog, Handlers>,
  ): Handlers => handlers;
}
