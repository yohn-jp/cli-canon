import type { CompiledCommand, CompiledProduct } from "../command/compiler.js";
import type {
  CommandCatalog,
  CommandDefinition,
  CommandId,
  FieldDefinition,
  FlagField,
  OptionField,
  OptionValueArity,
  PositionalField,
  RawArgsField,
} from "../command/model.js";

export interface CliInvocation {
  readonly executable: string;
  readonly argv: readonly string[];
}

export interface InvocationRequirement {
  readonly kind: "field";
  readonly name: string;
}

export type InvocationProjection<Id extends string = string> =
  | {
      readonly state: "ready";
      readonly commandId: Id;
      readonly value: CliInvocation;
    }
  | {
      readonly state: "requires-input";
      readonly commandId: Id;
      readonly executable: string;
      readonly route: readonly string[];
      readonly requirements: readonly InvocationRequirement[];
    };

type OptionToken<ValueArity extends OptionValueArity> =
  | string
  | (ValueArity extends "optional" ? true : never);

export type InvocationBinding<Field extends FieldDefinition> =
  Field extends PositionalField ? string
    : Field extends FlagField ? boolean
      : Field extends RawArgsField ? readonly string[]
        : Field extends OptionField<
          infer _Schema,
          infer Repeatable,
          infer _Required,
          infer ValueArity
        >
          ? Repeatable extends true
            ? readonly OptionToken<ValueArity>[]
            : OptionToken<ValueArity>
          : never;

export type InvocationBindings<Command extends CommandDefinition> = Readonly<Partial<{
  [Key in keyof Command["input"]]: InvocationBinding<Command["input"][Key]>;
}>>;

export class InvocationProjectionError extends Error {
  readonly code = "INVALID_INVOCATION_BINDING" as const;
  readonly commandId: string;
  readonly field?: string;

  constructor(commandId: string, message: string, field?: string) {
    super(message);
    this.name = "InvocationProjectionError";
    this.commandId = commandId;
    this.field = field;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validOptionToken(field: CompiledCommand["fields"][number], value: unknown): boolean {
  return typeof value === "string" || (field.valueArity === "optional" && value === true);
}

export function validateInvocationBindings(
  command: CompiledCommand,
  bindings: unknown,
): asserts bindings is Readonly<Record<string, unknown>> {
  if (!isRecord(bindings)) {
    throw new InvocationProjectionError(command.id, `${command.id}: invocation bindings must be an object`);
  }
  const fields = new Map(command.fields.map((field) => [field.key, field]));
  for (const [key, value] of Object.entries(bindings)) {
    const field = fields.get(key);
    if (field === undefined) {
      throw new InvocationProjectionError(command.id, `${command.id}: unknown invocation binding ${key}`, key);
    }
    if (value === undefined) continue;
    if (field.kind === "positional") {
      if (typeof value !== "string") {
        throw new InvocationProjectionError(command.id, `${command.id}.${key}: positional binding must be a string token`, key);
      }
      continue;
    }
    if (field.kind === "flag") {
      if (typeof value !== "boolean") {
        throw new InvocationProjectionError(command.id, `${command.id}.${key}: flag binding must be boolean`, key);
      }
      continue;
    }
    if (field.kind === "raw-args") {
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        throw new InvocationProjectionError(command.id, `${command.id}.${key}: raw argv binding must be a string array`, key);
      }
      continue;
    }
    if (field.repeatable === true) {
      if (!Array.isArray(value) || value.some((item) => !validOptionToken(field, item))) {
        throw new InvocationProjectionError(command.id, `${command.id}.${key}: repeatable option binding has an invalid token`, key);
      }
      continue;
    }
    if (!validOptionToken(field, value)) {
      throw new InvocationProjectionError(command.id, `${command.id}.${key}: option binding has an invalid token`, key);
    }
  }

  let omittedOptionalPositional = false;
  for (const field of command.fields) {
    if (field.kind !== "positional") continue;
    const value = bindings[field.key];
    if (value === undefined && field.required === false) {
      omittedOptionalPositional = true;
      continue;
    }
    if (value !== undefined && omittedOptionalPositional) {
      throw new InvocationProjectionError(
        command.id,
        `${command.id}.${field.key}: cannot bind a later positional after omitting an earlier optional positional`,
        field.key,
      );
    }
  }
}

function appendOption(argv: string[], flag: string, value: unknown): void {
  argv.push(flag);
  if (value !== true) argv.push(value as string);
}

export function projectInvocation<
  const Catalog extends CommandCatalog,
  const Id extends CommandId<Catalog>,
>(
  product: CompiledProduct<Catalog>,
  commandId: Id,
  bindings?: InvocationBindings<Catalog[Id]>,
): InvocationProjection<Id>;
export function projectInvocation(
  product: CompiledProduct,
  commandId: string,
  bindings: Readonly<Record<string, unknown>> = {},
): InvocationProjection {
  const command = product.commands.find((candidate) => String(candidate.id) === commandId);
  if (command === undefined) {
    throw new InvocationProjectionError(commandId, `unknown command ID: ${commandId}`);
  }
  validateInvocationBindings(command, bindings);

  const argv = [...command.route];
  const requirements: InvocationRequirement[] = [];
  let rawArgs: readonly string[] = [];

  for (const field of command.fields) {
    const value = bindings[field.key];
    if (field.kind === "positional") {
      if (value === undefined) {
        if (field.required === true) requirements.push({ kind: "field", name: field.key });
      } else {
        argv.push(value as string);
      }
      continue;
    }
    if (field.kind === "flag") {
      if (value === true && field.flag !== undefined) argv.push(field.flag);
      continue;
    }
    if (field.kind === "raw-args") {
      rawArgs = (value as readonly string[] | undefined) ?? [];
      continue;
    }
    if (value === undefined || (field.repeatable === true && Array.isArray(value) && value.length === 0)) {
      if (field.required === true) requirements.push({ kind: "field", name: field.key });
      continue;
    }
    if (field.flag === undefined) continue;
    if (field.repeatable === true) {
      for (const item of value as readonly unknown[]) appendOption(argv, field.flag, item);
    } else {
      appendOption(argv, field.flag, value);
    }
  }

  if (rawArgs.length > 0) argv.push("--", ...rawArgs);

  if (requirements.length > 0) {
    return Object.freeze({
      state: "requires-input" as const,
      commandId,
      executable: product.name,
      route: Object.freeze([...command.route]),
      requirements: Object.freeze(requirements.map((requirement) => Object.freeze(requirement))),
    });
  }

  return Object.freeze({
    state: "ready" as const,
    commandId,
    value: Object.freeze({
      executable: product.name,
      argv: Object.freeze(argv),
    }),
  });
}
