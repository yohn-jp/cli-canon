import type * as z from "zod";
import type { HandlerMap } from "./handlers.js";
import type {
  CommandCatalog,
  CommandDefinition,
  CommandId,
  InputDefinition,
} from "./model.js";

export interface CompiledField {
  readonly key: string;
  readonly kind: "positional" | "option" | "flag" | "raw-args";
  readonly flag?: string;
  readonly aliases?: readonly string[];
  readonly repeatable?: boolean;
  readonly placement?: "after-route" | "anywhere";
  readonly metavar?: string;
}

export interface CompiledCommand<
  Id extends string = string,
  Input extends InputDefinition = InputDefinition,
  Result extends z.ZodType = z.ZodType,
> {
  readonly id: Id;
  readonly route: readonly [string, ...string[]];
  readonly summary: string;
  readonly fields: readonly CompiledField[];
  /** Runtime validation authority; never emitted into the public manifest. */
  readonly definition: CommandDefinition<Input, Result>;
}

export interface CompileProductInput<Catalog extends CommandCatalog> {
  readonly name: string;
  readonly commands: Catalog;
  readonly handlers: HandlerMap<Catalog>;
}

export interface CompiledProduct<Catalog extends CommandCatalog = CommandCatalog> {
  readonly name: string;
  readonly commands: readonly CompiledCommand<
    CommandId<Catalog>,
    Catalog[CommandId<Catalog>]["input"],
    Catalog[CommandId<Catalog>]["result"]
  >[];
  readonly handlers: HandlerMap<Catalog>;
}

/**
 * Pure compile step. It validates cross-command references/grammar before any
 * Node adapter is built and returns no Commander objects.
 */
export declare function compileProduct<const Catalog extends CommandCatalog>(
  input: CompileProductInput<Catalog>,
): CompiledProduct<Catalog>;
