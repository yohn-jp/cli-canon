import type * as z from "zod";
import { CanonConstructionError, type CanonConstructionIssue } from "./errors.js";
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
  readonly required?: boolean;
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

const LONG_FLAG = /^--[a-z0-9][a-z0-9-]*$/u;
const SHORT_FLAG = /^-[A-Za-z0-9]$/u;

function fieldFlags(field: InputDefinition[string]): readonly string[] {
  return field.kind === "option" || field.kind === "flag" ? [field.flag, ...field.aliases] : [];
}

function signature(field: InputDefinition[string]): string {
  if (field.kind === "flag") return `flag:${field.flag}:${field.aliases.join(",")}`;
  if (field.kind === "option") {
    return `option:${field.flag}:${field.aliases.join(",")}:${field.repeatable}:${field.required}`;
  }
  return field.kind;
}

export function compileProduct<const Catalog extends CommandCatalog>(
  input: CompileProductInput<Catalog>,
): CompiledProduct<Catalog> {
  const issues: CanonConstructionIssue[] = [];
  const routes = new Map<string, string>();
  const anywhereFlags = new Map<string, { commandId: string; fieldKey: string; signature: string }>();
  const compiled: CompiledCommand[] = [];

  for (const [commandId, definition] of Object.entries(input.commands)) {
    if (definition.route.length === 0 || definition.route.some((segment) => segment.trim() === "" || /\s/u.test(segment))) {
      issues.push({ code: "INVALID_ROUTE", commandId, message: `${commandId}: route segments must be non-empty single tokens` });
    }
    const routeKey = definition.route.join("\u0000");
    const existingRoute = routes.get(routeKey);
    if (existingRoute !== undefined) {
      issues.push({
        code: "DUPLICATE_ROUTE",
        commandId,
        message: `${commandId}: route duplicates ${existingRoute}: ${definition.route.join(" ")}`,
      });
    } else {
      routes.set(routeKey, commandId);
    }

    const localFlags = new Map<string, string>();
    let rawArgsCount = 0;
    const fields: CompiledField[] = [];

    for (const [fieldKey, field] of Object.entries(definition.input)) {
      if (field.kind === "raw-args") rawArgsCount += 1;
      for (const candidate of fieldFlags(field)) {
        if (!(LONG_FLAG.test(candidate) || SHORT_FLAG.test(candidate))) {
          issues.push({ code: "INVALID_FLAG", commandId, field: fieldKey, message: `${commandId}.${fieldKey}: invalid flag ${candidate}` });
          continue;
        }
        const existingField = localFlags.get(candidate);
        if (existingField !== undefined) {
          issues.push({ code: "FLAG_COLLISION", commandId, field: fieldKey, message: `${commandId}: ${candidate} is used by both ${existingField} and ${fieldKey}` });
        } else {
          localFlags.set(candidate, fieldKey);
        }
        if ((field.kind === "option" || field.kind === "flag") && field.placement === "anywhere") {
          const current = { commandId, fieldKey, signature: signature(field) };
          const existing = anywhereFlags.get(candidate);
          if (existing !== undefined && existing.signature !== current.signature) {
            issues.push({
              code: "FLAG_COLLISION",
              commandId,
              field: fieldKey,
              message: `${candidate}: anywhere option conflicts with ${existing.commandId}.${existing.fieldKey}`,
            });
          } else if (existing === undefined) {
            anywhereFlags.set(candidate, current);
          }
        }
      }
      fields.push(Object.freeze({
        key: fieldKey,
        kind: field.kind,
        ...(field.kind === "option" || field.kind === "flag"
          ? { flag: field.flag, aliases: Object.freeze([...field.aliases]), placement: field.placement }
          : {}),
        ...(field.kind === "option" ? { repeatable: field.repeatable, required: field.required } : {}),
        ...(field.kind === "positional" || field.kind === "option"
          ? (field.metavar === undefined ? {} : { metavar: field.metavar })
          : {}),
      }));
    }

    if (rawArgsCount > 1) {
      issues.push({ code: "INVALID_INPUT_GRAMMAR", commandId, message: `${commandId}: only one rawArgs field is supported` });
    }

    compiled.push(Object.freeze({
      id: commandId,
      route: Object.freeze([...definition.route]) as readonly [string, ...string[]],
      summary: definition.summary,
      fields: Object.freeze(fields),
      definition,
    }));
  }

  if (issues.length > 0) throw new CanonConstructionError(issues);

  return Object.freeze({
    name: input.name,
    commands: Object.freeze(compiled) as CompiledProduct<Catalog>["commands"],
    handlers: input.handlers,
  });
}
