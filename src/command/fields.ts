import type * as z from "zod";
import type {
  FlagField,
  OptionField,
  OptionPlacement,
  PositionalField,
  RawArgsField,
} from "./model.js";

export interface PositionalConfig {
  readonly metavar?: string;
}

export interface OptionConfig<Repeatable extends boolean = false, Required extends boolean = false> {
  readonly aliases?: readonly string[];
  readonly repeatable?: Repeatable;
  readonly required?: Required;
  readonly placement?: OptionPlacement;
  readonly metavar?: string;
}

export interface FlagConfig {
  readonly aliases?: readonly string[];
  readonly placement?: OptionPlacement;
}

function freezeAliases(aliases: readonly string[] | undefined): readonly string[] {
  return Object.freeze([...(aliases ?? [])]);
}

export function positional<const Schema extends z.ZodType>(
  schema: Schema,
  config: PositionalConfig = {},
): PositionalField<Schema> {
  return Object.freeze({
    kind: "positional",
    schema,
    ...(config.metavar === undefined ? {} : { metavar: config.metavar }),
  });
}

export function option<
  const Schema extends z.ZodType,
  const Repeatable extends boolean = false,
  const Required extends boolean = false,
>(
  flag: `--${string}`,
  schema: Schema,
  config: OptionConfig<Repeatable, Required> = {},
): OptionField<Schema, Repeatable, Required> {
  return Object.freeze({
    kind: "option",
    flag,
    aliases: freezeAliases(config.aliases),
    schema,
    repeatable: (config.repeatable ?? false) as Repeatable,
    required: (config.required ?? false) as Required,
    placement: config.placement ?? "after-route",
    ...(config.metavar === undefined ? {} : { metavar: config.metavar }),
  });
}

export function flag(name: `--${string}`, config: FlagConfig = {}): FlagField {
  return Object.freeze({
    kind: "flag",
    flag: name,
    aliases: freezeAliases(config.aliases),
    placement: config.placement ?? "after-route",
  });
}

export function rawArgs(): RawArgsField {
  return Object.freeze({ kind: "raw-args", afterDoubleDash: true });
}
