import type * as z from "zod";

export type AnySchema = z.ZodType;
export type OptionPlacement = "after-route" | "anywhere";
export type OptionValueArity = "required" | "optional";
export type OptionLookingValuePolicy = "consume" | "reject";
export type CommandVisibility = "public" | "private";

export interface PositionalField<Schema extends AnySchema = AnySchema, Required extends boolean = boolean> {
  readonly kind: "positional";
  readonly schema: Schema;
  readonly required: Required;
  readonly metavar?: string;
  readonly description?: string;
}

export interface OptionField<
  Schema extends AnySchema = AnySchema,
  Repeatable extends boolean = boolean,
  Required extends boolean = boolean,
  ValueArity extends OptionValueArity = OptionValueArity,
  LookingValuePolicy extends OptionLookingValuePolicy = OptionLookingValuePolicy,
> {
  readonly kind: "option";
  readonly flag: `--${string}`;
  readonly aliases: readonly string[];
  readonly schema: Schema;
  readonly repeatable: Repeatable;
  readonly required: Required;
  readonly valueArity: ValueArity;
  readonly optionLookingValuePolicy: LookingValuePolicy;
  readonly placement: OptionPlacement;
  readonly metavar?: string;
  readonly description?: string;
}

export interface FlagField {
  readonly kind: "flag";
  readonly flag: `--${string}`;
  readonly aliases: readonly string[];
  readonly placement: OptionPlacement;
  readonly description?: string;
}

export interface RawArgsField {
  readonly kind: "raw-args";
  readonly afterDoubleDash: true;
}

export type FieldDefinition = PositionalField | OptionField | FlagField | RawArgsField;
export type InputDefinition = Readonly<Record<string, FieldDefinition>>;

export interface CommandDefinition<
  Input extends InputDefinition = InputDefinition,
  Result extends AnySchema = AnySchema,
> {
  readonly route: readonly [string, ...string[]];
  readonly summary: string;
  readonly description?: string;
  readonly visibility?: CommandVisibility;
  readonly examples?: readonly string[];
  readonly input: Input;
  readonly result: Result;
  /**
   * Declares option occurrences whose relative argv order carries meaning.
   * The current Commander adapter rejects these groups explicitly.
   */
  readonly orderedOptionGroups?: readonly (readonly Extract<keyof Input, string>[])[];
}

export type CommandCatalog = Readonly<Record<string, CommandDefinition>>;

export type FieldOutput<Field extends FieldDefinition> =
  Field extends PositionalField<infer Schema, infer Required>
    ? Required extends true
      ? z.output<Schema>
      : z.output<Schema> | undefined
    : Field extends OptionField<infer Schema, infer Repeatable, infer Required, infer ValueArity>
      ? Repeatable extends true
        ? ValueArity extends "optional"
          ? readonly (z.output<Schema> | undefined)[]
          : readonly z.output<Schema>[]
        : Required extends true
          ? ValueArity extends "optional"
            ? z.output<Schema> | undefined
            : z.output<Schema>
          : z.output<Schema> | undefined
      : Field extends FlagField
        ? boolean
        : Field extends RawArgsField
          ? readonly string[]
          : never;

export type CommandInput<Command extends CommandDefinition> = {
  readonly [Key in keyof Command["input"]]: FieldOutput<Command["input"][Key]>;
};

export type CommandResultInput<Command extends CommandDefinition> = z.input<Command["result"]>;
export type CommandResultOutput<Command extends CommandDefinition> = z.output<Command["result"]>;
export type CommandId<Catalog extends CommandCatalog> = Extract<keyof Catalog, string>;
