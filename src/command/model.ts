import type * as z from "zod";

/**
 * M0 authoring model.
 *
 * These types define the single declaration graph from which routing, handler
 * input, help, and discovery will be derived. Runtime implementation belongs
 * in later commits; this file intentionally contains no parser or I/O.
 */
export type AnySchema = z.ZodType;
export type OptionPlacement = "after-route" | "anywhere";

export interface PositionalField<Schema extends AnySchema = AnySchema> {
  readonly kind: "positional";
  readonly schema: Schema;
  readonly metavar?: string;
}

export interface OptionField<
  Schema extends AnySchema = AnySchema,
  Repeatable extends boolean = boolean,
> {
  readonly kind: "option";
  readonly flag: `--${string}`;
  readonly aliases: readonly string[];
  readonly schema: Schema;
  readonly repeatable: Repeatable;
  readonly placement: OptionPlacement;
  readonly metavar?: string;
}

export interface FlagField {
  readonly kind: "flag";
  readonly flag: `--${string}`;
  readonly aliases: readonly string[];
  readonly placement: OptionPlacement;
}

export interface RawArgsField {
  readonly kind: "raw-args";
  readonly afterDoubleDash: true;
}

export type FieldDefinition =
  | PositionalField
  | OptionField
  | FlagField
  | RawArgsField;

export type InputDefinition = Readonly<Record<string, FieldDefinition>>;

export interface CommandDefinition<
  Input extends InputDefinition = InputDefinition,
  Result extends AnySchema = AnySchema,
> {
  readonly route: readonly [string, ...string[]];
  readonly summary: string;
  readonly input: Input;
  readonly result: Result;
}

export type CommandCatalog = Readonly<Record<string, CommandDefinition>>;

export type FieldOutput<Field extends FieldDefinition> =
  Field extends PositionalField<infer Schema>
    ? z.output<Schema>
    : Field extends OptionField<infer Schema, infer Repeatable>
      ? Repeatable extends true
        ? readonly z.output<Schema>[]
        : z.output<Schema> | undefined
      : Field extends FlagField
        ? boolean
        : Field extends RawArgsField
          ? readonly string[]
          : never;

export type CommandInput<Command extends CommandDefinition> = {
  readonly [Key in keyof Command["input"]]: FieldOutput<Command["input"][Key]>;
};

export type CommandResultInput<Command extends CommandDefinition> = z.input<
  Command["result"]
>;

export type CommandResultOutput<Command extends CommandDefinition> = z.output<
  Command["result"]
>;

export type CommandId<Catalog extends CommandCatalog> = Extract<
  keyof Catalog,
  string
>;
