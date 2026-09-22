import type * as z from "zod";
import type {
  FlagField,
  OptionField,
  OptionPlacement,
  PositionalField,
  RawArgsField,
} from "./model.js";

/**
 * Typed field constructors. Their runtime implementation will remain trivial:
 * they create immutable declarations and perform local shape validation only.
 */
export interface PositionalConfig {
  readonly metavar?: string;
}

export interface OptionConfig<Repeatable extends boolean = false> {
  readonly aliases?: readonly string[];
  readonly repeatable?: Repeatable;
  readonly placement?: OptionPlacement;
  readonly metavar?: string;
}

export interface FlagConfig {
  readonly aliases?: readonly string[];
  readonly placement?: OptionPlacement;
}

export declare function positional<const Schema extends z.ZodType>(
  schema: Schema,
  config?: PositionalConfig,
): PositionalField<Schema>;

export declare function option<
  const Schema extends z.ZodType,
  const Repeatable extends boolean = false,
>(
  flag: `--${string}`,
  schema: Schema,
  config?: OptionConfig<Repeatable>,
): OptionField<Schema, Repeatable>;

export declare function flag(
  name: `--${string}`,
  config?: FlagConfig,
): FlagField;

export declare function rawArgs(): RawArgsField;
