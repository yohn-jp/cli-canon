import type * as z from "zod";
import { CanonConstructionError, type CanonConstructionIssue } from "./errors.js";
import type { HandlerMap } from "./handlers.js";
import type {
  CommandCatalog,
  CommandDefinition,
  CommandId,
  InputDefinition,
  OptionLookingValuePolicy,
  OptionValueArity,
} from "./model.js";
import { compileSkills, type CompiledSkills } from "../skill/compiler.js";
import type { SkillCatalog } from "../skill/model.js";
import { compilePaths } from "../path/paths.js";
import type { CompiledPaths, PathCatalog } from "../path/model.js";
import type { ProductPackageIdentity } from "../product/identity.js";

export interface CompiledField {
  readonly key: string;
  readonly kind: "positional" | "option" | "flag" | "raw-args";
  readonly flag?: string;
  readonly aliases?: readonly string[];
  readonly repeatable?: boolean;
  readonly required?: boolean;
  readonly valueArity?: OptionValueArity;
  readonly optionLookingValuePolicy?: OptionLookingValuePolicy;
  readonly placement?: "after-route" | "anywhere";
  readonly metavar?: string;
  readonly description?: string;
}

export interface CompiledCommand<
  Id extends string = string,
  Input extends InputDefinition = InputDefinition,
  Result extends z.ZodType = z.ZodType,
> {
  readonly id: Id;
  readonly route: readonly [string, ...string[]];
  readonly summary: string;
  readonly description?: string;
  readonly examples?: readonly string[];
  readonly fields: readonly CompiledField[];
  readonly definition: CommandDefinition<Input, Result>;
}

export interface CompileProductInput<
  Catalog extends CommandCatalog,
  Skills extends SkillCatalog<CommandId<Catalog>> = SkillCatalog<CommandId<Catalog>>,
  Paths extends PathCatalog<Extract<keyof Paths, string>> = PathCatalog,
> {
  readonly name: string;
  readonly commands: Catalog;
  readonly handlers: HandlerMap<Catalog>;
  /** Package.json metadata supplied by the product composition root. */
  readonly packageMetadata?: ProductPackageIdentity;
  readonly skills?: Skills;
  readonly paths?: Paths;
}

export interface CompiledProduct<
  Catalog extends CommandCatalog = CommandCatalog,
  Skills extends SkillCatalog<CommandId<Catalog>> = SkillCatalog<CommandId<Catalog>>,
  Paths extends PathCatalog<Extract<keyof Paths, string>> = PathCatalog,
> {
  readonly name: string;
  readonly commands: readonly CompiledCommand<
    CommandId<Catalog>,
    Catalog[CommandId<Catalog>]["input"],
    Catalog[CommandId<Catalog>]["result"]
  >[];
  readonly handlers: HandlerMap<Catalog>;
  readonly packageMetadata?: ProductPackageIdentity;
  readonly skills: CompiledSkills<Skills>;
  readonly paths: CompiledPaths<Paths>;
}

const LONG_FLAG = /^--[a-z0-9][a-z0-9-]*$/u;
const SHORT_FLAG = /^-[A-Za-z0-9]$/u;

function fieldFlags(field: InputDefinition[string]): readonly string[] {
  return field.kind === "option" || field.kind === "flag" ? [field.flag, ...field.aliases] : [];
}

function signature(field: InputDefinition[string]): string {
  if (field.kind === "flag") return `flag:${field.flag}:${field.aliases.join(",")}`;
  if (field.kind === "option") {
    return `option:${field.flag}:${field.aliases.join(",")}:${field.repeatable}:${field.required}:${field.valueArity}:${field.optionLookingValuePolicy}`;
  }
  return field.kind;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compilePackageMetadata(
  value: unknown,
  issues: CanonConstructionIssue[],
): ProductPackageIdentity | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    issues.push({
      code: "INVALID_PRODUCT_IDENTITY",
      message: "packageMetadata must be package metadata with a non-empty name and version",
    });
    return undefined;
  }

  const { name, version } = value;
  if (typeof name !== "string" || name.trim().length === 0 || typeof version !== "string" || version.trim().length === 0) {
    issues.push({
      code: "INVALID_PRODUCT_IDENTITY",
      message: "packageMetadata must have a non-empty name and version",
    });
    return undefined;
  }

  let bin: ProductPackageIdentity["bin"];
  if (value.bin !== undefined) {
    if (typeof value.bin === "string" && value.bin.length > 0) {
      bin = value.bin;
    } else if (isRecord(value.bin)) {
      const normalizedBins: Record<string, string> = {};
      let valid = Object.keys(value.bin).length > 0;
      for (const [commandName, executable] of Object.entries(value.bin)) {
        if (commandName.length === 0 || typeof executable !== "string" || executable.length === 0) {
          valid = false;
        } else {
          Object.defineProperty(normalizedBins, commandName, {
            value: executable,
            enumerable: true,
            configurable: true,
            writable: true,
          });
        }
      }
      if (valid) {
        bin = Object.freeze(normalizedBins);
      } else {
        issues.push({
          code: "INVALID_PRODUCT_IDENTITY",
          message: "packageMetadata.bin must be a non-empty executable path or command map",
        });
      }
    } else {
      issues.push({
        code: "INVALID_PRODUCT_IDENTITY",
        message: "packageMetadata.bin must be a non-empty executable path or command map",
      });
    }
  }

  return Object.freeze({
    name,
    version,
    ...(bin === undefined ? {} : { bin }),
  });
}

export function compileProduct<
  const Catalog extends CommandCatalog,
  const Skills extends SkillCatalog<CommandId<Catalog>> = SkillCatalog<CommandId<Catalog>>,
  const Paths extends PathCatalog<Extract<keyof Paths, string>> = PathCatalog,
>(
  input: CompileProductInput<Catalog, Skills, Paths>,
): CompiledProduct<Catalog, Skills, Paths> {
  const issues: CanonConstructionIssue[] = [];
  const packageMetadata = compilePackageMetadata(input.packageMetadata, issues);
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
    let rawArgsSeen = false;
    let optionalPositionalSeen = false;
    const fields: CompiledField[] = [];

    for (const group of definition.orderedOptionGroups ?? []) {
      const validGroup = group.length > 1 && group.every((fieldKey) => {
        const field = definition.input[fieldKey];
        return field?.kind === "option" && field.repeatable;
      });
      if (!validGroup) {
        issues.push({
          code: "INVALID_INPUT_GRAMMAR",
          commandId,
          fields: Object.freeze([...group]),
          message: `${commandId}: ordered option groups must name at least two repeatable option fields`,
        });
      } else {
        issues.push({
          code: "UNSUPPORTED_GRAMMAR",
          commandId,
          fields: Object.freeze([...group]),
          message: `${commandId}: Commander cannot preserve ordered occurrences for option fields ${group.join(", ")}`,
        });
      }
    }

    for (const [fieldKey, field] of Object.entries(definition.input)) {
      if (field.kind === "raw-args") {
        rawArgsCount += 1;
        rawArgsSeen = true;
      } else if (field.kind === "positional") {
        if (rawArgsSeen) {
          issues.push({
            code: "INVALID_INPUT_GRAMMAR",
            commandId,
            field: fieldKey,
            message: `${commandId}.${fieldKey}: positional fields must precede rawArgs`,
          });
        }
        if (!field.required) optionalPositionalSeen = true;
        else if (optionalPositionalSeen) {
          issues.push({
            code: "INVALID_INPUT_GRAMMAR",
            commandId,
            field: fieldKey,
            message: `${commandId}.${fieldKey}: a required positional cannot follow an optional positional`,
          });
        }
      }
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
        if (candidate === "--help" || candidate === "-h") {
          issues.push({
            code: "FLAG_COLLISION",
            commandId,
            field: fieldKey,
            message: `${commandId}.${fieldKey}: ${candidate} is reserved for Canon help`,
          });
        }
        if (field.kind === "option" && field.optionLookingValuePolicy === "reject") {
          issues.push({
            code: "UNSUPPORTED_GRAMMAR",
            commandId,
            field: fieldKey,
            message: `${commandId}.${fieldKey}: Commander consumes option-looking tokens as required option values`,
          });
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
        ...(field.kind === "positional"
          ? { required: field.required, ...(field.description === undefined ? {} : { description: field.description }) }
          : {}),
        ...(field.kind === "option" || field.kind === "flag"
          ? {
            flag: field.flag,
            aliases: Object.freeze([...field.aliases]),
            placement: field.placement,
            ...(field.description === undefined ? {} : { description: field.description }),
          }
          : {}),
        ...(field.kind === "option"
          ? {
            repeatable: field.repeatable,
            required: field.required,
            valueArity: field.valueArity,
            optionLookingValuePolicy: field.optionLookingValuePolicy,
          }
          : {}),
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
      ...(definition.description === undefined ? {} : { description: definition.description }),
      ...(definition.examples === undefined ? {} : { examples: Object.freeze([...definition.examples]) }),
      fields: Object.freeze(fields),
      definition,
    }));
  }

  if (issues.length > 0) throw new CanonConstructionError(issues);

  const skills = compileSkills(input.skills ?? {} as Skills, compiled);
  const paths = compilePaths(input.paths ?? {} as Paths);

  return Object.freeze({
    name: input.name,
    commands: Object.freeze(compiled) as CompiledProduct<Catalog>["commands"],
    handlers: input.handlers,
    ...(packageMetadata === undefined ? {} : { packageMetadata }),
    skills,
    paths,
  });
}
