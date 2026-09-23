import type * as z from "zod";
import type {
  FlagField,
  OptionLookingValuePolicy,
  OptionField,
  OptionPlacement,
  OptionValueArity,
  PositionalField,
  RawArgsField,
} from "./model.js";

export interface PositionalConfig {
  readonly required?: boolean;
  readonly metavar?: string;
  readonly description?: string;
}

export interface OptionConfig<
  Repeatable extends boolean = false,
  Required extends boolean = false,
  ValueArity extends OptionValueArity = "required",
  LookingValuePolicy extends OptionLookingValuePolicy = "consume",
> {
  readonly aliases?: readonly string[];
  readonly repeatable?: Repeatable;
  readonly required?: Required;
  readonly valueArity?: ValueArity;
  readonly optionLookingValuePolicy?: LookingValuePolicy;
  readonly placement?: OptionPlacement;
  readonly metavar?: string;
  readonly description?: string;
}

type ConfigBoolean<Config, Key extends string, Default extends boolean> =
  Key extends keyof Config
    ? Exclude<Config[Key & keyof Config], undefined> | (undefined extends Config[Key & keyof Config] ? Default : never)
    : Default;

type PositionalRequired<Config extends PositionalConfig> = ConfigBoolean<Config, "required", true>;
type OptionRepeatable<Config extends OptionConfig<boolean, boolean, OptionValueArity, OptionLookingValuePolicy>> = ConfigBoolean<Config, "repeatable", false>;
type OptionRequired<Config extends OptionConfig<boolean, boolean, OptionValueArity, OptionLookingValuePolicy>> = ConfigBoolean<Config, "required", false>;
type OptionValue<Config extends OptionConfig<boolean, boolean, OptionValueArity, OptionLookingValuePolicy>> = "valueArity" extends keyof Config
  ? Exclude<Config["valueArity" & keyof Config], undefined> | (undefined extends Config["valueArity" & keyof Config] ? "required" : never)
  : "required";
type OptionLookingValue<Config extends OptionConfig<boolean, boolean, OptionValueArity, OptionLookingValuePolicy>> = "optionLookingValuePolicy" extends keyof Config
  ? Exclude<Config["optionLookingValuePolicy" & keyof Config], undefined> | (undefined extends Config["optionLookingValuePolicy" & keyof Config] ? "consume" : never)
  : "consume";

export interface FlagConfig {
  readonly aliases?: readonly string[];
  readonly placement?: OptionPlacement;
  readonly description?: string;
}

function freezeAliases(aliases: readonly string[] | undefined): readonly string[] {
  return Object.freeze([...(aliases ?? [])]);
}

export function positional<const Schema extends z.ZodType>(schema: Schema): PositionalField<Schema, true>;
export function positional<const Schema extends z.ZodType, const Config extends PositionalConfig>(
  schema: Schema,
  config: Config,
): PositionalField<Schema, PositionalRequired<Config>>;
export function positional(
  schema: z.ZodType,
  config: PositionalConfig = {},
): PositionalField<z.ZodType, boolean> {
  return Object.freeze({
    kind: "positional",
    schema,
    required: config.required ?? true,
    ...(config.metavar === undefined ? {} : { metavar: config.metavar }),
    ...(config.description === undefined ? {} : { description: config.description }),
  });
}

type CanonOptionConfig = OptionConfig<boolean, boolean, OptionValueArity, OptionLookingValuePolicy>;

export function option<const Schema extends z.ZodType>(
  flag: `--${string}`,
  schema: Schema,
): OptionField<Schema, false, false, "required", "consume">;
export function option<const Schema extends z.ZodType, const Config extends CanonOptionConfig>(
  flag: `--${string}`,
  schema: Schema,
  config: Config,
): OptionField<Schema, OptionRepeatable<Config>, OptionRequired<Config>, OptionValue<Config>, OptionLookingValue<Config>>;
export function option(
  flag: `--${string}`,
  schema: z.ZodType,
  config: CanonOptionConfig = {},
): OptionField<z.ZodType, boolean, boolean, OptionValueArity, OptionLookingValuePolicy> {
  return Object.freeze({
    kind: "option",
    flag,
    aliases: freezeAliases(config.aliases),
    schema,
    repeatable: config.repeatable ?? false,
    required: config.required ?? false,
    valueArity: config.valueArity ?? "required",
    optionLookingValuePolicy: config.optionLookingValuePolicy ?? "consume",
    placement: config.placement ?? "after-route",
    ...(config.metavar === undefined ? {} : { metavar: config.metavar }),
    ...(config.description === undefined ? {} : { description: config.description }),
  });
}

export function flag(name: `--${string}`, config: FlagConfig = {}): FlagField {
  return Object.freeze({
    kind: "flag",
    flag: name,
    aliases: freezeAliases(config.aliases),
    placement: config.placement ?? "after-route",
    ...(config.description === undefined ? {} : { description: config.description }),
  });
}

export function rawArgs(): RawArgsField {
  return Object.freeze({ kind: "raw-args", afterDoubleDash: true });
}
