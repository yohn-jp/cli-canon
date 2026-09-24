import type * as z from "zod";
import { CanonConstructionError, type CanonConstructionIssue } from "./errors.js";
import type { HandlerMap } from "./handlers.js";
import type {
  CommandCatalog,
  CommandDefinition,
  CommandId,
  FieldDefinition,
  GroupCatalog,
  GroupDefinition,
  InputDefinition,
  OptionLookingValuePolicy,
  OptionValueArity,
} from "./model.js";
import { commandTreeCommands, compileCommandTree, type CommandTreeRootNode } from "./tree.js";
import { compileSkills, type CompiledSkills } from "../skill/compiler.js";
import type { SkillCatalog, SkillId } from "../skill/model.js";
import { compilePaths } from "../path/paths.js";
import type { CompiledPaths, PathCatalog } from "../path/model.js";
import type { ProductPackageIdentity } from "../product/identity.js";
import { renderHelp } from "../projection/help.js";
import { projectDiscovery } from "../projection/discovery.js";
import {
  projectProductSchemas,
  SchemaProjectionError,
  type SchemaProjectionCompleteness,
} from "../projection/schema.js";
import { projectSkills, renderSkillJson, renderSkillText } from "../skill/projection.js";

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
  readonly visibility: "public" | "private";
  readonly description?: string;
  readonly examples?: readonly string[];
  readonly fields: readonly CompiledField[];
  readonly definition: CommandDefinition<Input, Result>;
}

export interface CompileProductInput<
  Catalog extends CommandCatalog,
  Skills extends SkillCatalog<CommandId<Catalog>, SkillId<Skills>> = SkillCatalog<CommandId<Catalog>>,
  Paths extends PathCatalog<Extract<keyof Paths, string>> = PathCatalog,
  Groups extends GroupCatalog = Readonly<Record<never, GroupDefinition>>,
> {
  readonly name: string;
  readonly commands: Catalog;
  /** Non-executable route groups compiled into the canonical command tree. */
  readonly groups?: Groups;
  readonly handlers: HandlerMap<Catalog>;
  /** Package.json metadata supplied by the product composition root. */
  readonly packageMetadata?: ProductPackageIdentity;
  /** Declares a public schema contract that must be admitted during construction. */
  readonly schemaProjectionCompleteness?: SchemaProjectionCompleteness;
  readonly skills?: Skills;
  readonly paths?: Paths;
}

export interface CompiledProduct<
  Catalog extends CommandCatalog = CommandCatalog,
  Skills extends SkillCatalog<CommandId<Catalog>, SkillId<Skills>> = SkillCatalog<CommandId<Catalog>>,
  Paths extends PathCatalog<Extract<keyof Paths, string>> = PathCatalog,
  Groups extends GroupCatalog = GroupCatalog,
> {
  readonly name: string;
  /** The one canonical structural authority for groups and commands. */
  readonly tree: CommandTreeRootNode<Groups, Catalog>;
  /** Compatibility flat view derived from the canonical tree in depth-first order. */
  readonly commands: readonly CompiledCommand<
    CommandId<Catalog>,
    Catalog[CommandId<Catalog>]["input"],
    Catalog[CommandId<Catalog>]["result"]
  >[];
  readonly handlers: HandlerMap<Catalog>;
  readonly packageMetadata?: ProductPackageIdentity;
  readonly schemaProjectionCompleteness?: SchemaProjectionCompleteness;
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

function snapshotField(field: FieldDefinition): FieldDefinition {
  return field.kind === "option" || field.kind === "flag"
    ? Object.freeze({ ...field, aliases: Object.freeze([...field.aliases]) })
    : Object.freeze({ ...field });
}

function snapshotCommandDefinition<Input extends InputDefinition, Result extends z.ZodType>(
  definition: CommandDefinition<Input, Result>,
): CommandDefinition<Input, Result> {
  const input = Object.freeze(
    Object.fromEntries(Object.entries(definition.input).map(([key, field]) => [key, snapshotField(field)])),
  ) as Input;
  const orderedOptionGroups = definition.orderedOptionGroups?.map((group) => Object.freeze([...group]));
  return Object.freeze({
    route: Object.freeze([...definition.route]) as CommandDefinition<Input, Result>["route"],
    summary: definition.summary,
    ...(definition.description === undefined ? {} : { description: definition.description }),
    ...(definition.visibility === undefined ? {} : { visibility: definition.visibility }),
    ...(definition.examples === undefined ? {} : { examples: Object.freeze([...definition.examples]) }),
    input,
    result: definition.result,
    ...(orderedOptionGroups === undefined ? {} : { orderedOptionGroups: Object.freeze(orderedOptionGroups) }),
  });
}

function snapshotHandlers<Catalog extends CommandCatalog>(handlers: HandlerMap<Catalog>): HandlerMap<Catalog> {
  return Object.freeze(Object.fromEntries(Object.entries(handlers))) as HandlerMap<Catalog>;
}

function compilePackageMetadata(value: unknown, issues: CanonConstructionIssue[]): ProductPackageIdentity | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    issues.push({
      code: "INVALID_PRODUCT_IDENTITY",
      message: "packageMetadata must be package metadata with a non-empty name and version",
    });
    return undefined;
  }

  const { name, version } = value;
  if (
    typeof name !== "string" ||
    name.trim().length === 0 ||
    typeof version !== "string" ||
    version.trim().length === 0
  ) {
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
  const Skills extends SkillCatalog<CommandId<Catalog>, SkillId<Skills>> = SkillCatalog<CommandId<Catalog>>,
  const Paths extends PathCatalog<Extract<keyof Paths, string>> = PathCatalog,
  const Groups extends GroupCatalog = Readonly<Record<never, GroupDefinition>>,
>(input: CompileProductInput<Catalog, Skills, Paths, Groups>): CompiledProduct<Catalog, Skills, Paths, Groups> {
  const issues: CanonConstructionIssue[] = [];
  const packageMetadata = compilePackageMetadata(input.packageMetadata, issues);
  const routes = new Map<string, string>();
  const anywhereFlags = new Map<string, { commandId: string; fieldKey: string; signature: string }>();
  const declared: { readonly id: string; readonly definition: CommandDefinition }[] = [];
  const fieldsById = new Map<string, readonly CompiledField[]>();
  const suppliedHandlers = isRecord(input.handlers) ? input.handlers : undefined;
  if (suppliedHandlers === undefined) {
    issues.push({
      code: "INVALID_HANDLER_BINDING",
      message: "handlers must be an object mapping every command ID to a function",
    });
  } else {
    for (const commandId of Object.keys(input.commands)) {
      if (!Object.hasOwn(suppliedHandlers, commandId) || typeof suppliedHandlers[commandId] !== "function") {
        issues.push({
          code: "INVALID_HANDLER_BINDING",
          commandId,
          message: `${commandId}: command handler must be a function`,
        });
      }
    }
    for (const handlerId of Object.keys(suppliedHandlers)) {
      if (!Object.hasOwn(input.commands, handlerId)) {
        issues.push({
          code: "INVALID_HANDLER_BINDING",
          commandId: handlerId,
          message: `${handlerId}: handler has no matching command declaration`,
        });
      }
    }
  }

  for (const [commandId, definition] of Object.entries(input.commands)) {
    if (
      definition.visibility !== undefined &&
      definition.visibility !== "public" &&
      definition.visibility !== "private"
    ) {
      issues.push({
        code: "INVALID_COMMAND_VISIBILITY",
        commandId,
        message: `${commandId}: visibility must be public or private`,
      });
    }
    if (
      definition.route.length === 0 ||
      definition.route.some((segment) => segment.trim() === "" || /\s/u.test(segment))
    ) {
      issues.push({
        code: "INVALID_ROUTE",
        commandId,
        message: `${commandId}: route segments must be non-empty single tokens`,
      });
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
      const validGroup =
        group.length > 1 &&
        group.every((fieldKey) => {
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
          issues.push({
            code: "INVALID_FLAG",
            commandId,
            field: fieldKey,
            message: `${commandId}.${fieldKey}: invalid flag ${candidate}`,
          });
          continue;
        }
        const existingField = localFlags.get(candidate);
        if (existingField !== undefined) {
          issues.push({
            code: "FLAG_COLLISION",
            commandId,
            field: fieldKey,
            message: `${commandId}: ${candidate} is used by both ${existingField} and ${fieldKey}`,
          });
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
      fields.push(
        Object.freeze({
          key: fieldKey,
          kind: field.kind,
          ...(field.kind === "positional"
            ? {
                required: field.required,
                ...(field.description === undefined ? {} : { description: field.description }),
              }
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
            ? field.metavar === undefined
              ? {}
              : { metavar: field.metavar }
            : {}),
        }),
      );
    }

    if (rawArgsCount > 1) {
      issues.push({
        code: "INVALID_INPUT_GRAMMAR",
        commandId,
        message: `${commandId}: only one rawArgs field is supported`,
      });
    }

    fieldsById.set(commandId, Object.freeze(fields));
    declared.push({ id: commandId, definition: snapshotCommandDefinition(definition) });
  }

  const tree = compileCommandTree(input.groups, declared, issues);
  if (tree === undefined || issues.length > 0) throw new CanonConstructionError(issues);

  const compiled: CompiledCommand[] = commandTreeCommands(tree).map(({ id, route, definition }) =>
    Object.freeze({
      id,
      route,
      summary: definition.summary,
      visibility: definition.visibility ?? "public",
      ...(definition.description === undefined ? {} : { description: definition.description }),
      ...(definition.examples === undefined ? {} : { examples: definition.examples }),
      fields: fieldsById.get(id) ?? Object.freeze([]),
      definition,
    }),
  );

  const skills = compileSkills(input.skills ?? ({} as Skills), compiled);
  const paths = compilePaths(input.paths ?? ({} as Paths));
  const handlers = snapshotHandlers(input.handlers);

  const product = Object.freeze({
    name: input.name,
    tree: tree as unknown as CommandTreeRootNode<Groups, Catalog>,
    commands: Object.freeze(compiled) as CompiledProduct<Catalog>["commands"],
    handlers,
    ...(packageMetadata === undefined ? {} : { packageMetadata }),
    ...(input.schemaProjectionCompleteness === undefined
      ? {}
      : { schemaProjectionCompleteness: input.schemaProjectionCompleteness }),
    skills,
    paths,
  }) as CompiledProduct<Catalog, Skills, Paths, Groups>;

  const projectionIssues: CanonConstructionIssue[] = [];
  try {
    renderHelp(product);
    projectDiscovery(product);
  } catch (error) {
    projectionIssues.push({
      code: "INVALID_PROJECTION",
      message: `framework projection failed during construction: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  try {
    for (const skill of projectSkills(product)) {
      try {
        renderSkillText(skill);
        renderSkillJson(skill);
      } catch (error) {
        projectionIssues.push({
          code: "INVALID_PROJECTION",
          skillId: skill.id,
          message: `skill ${skill.id}: projection failed during construction: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  } catch (error) {
    projectionIssues.push({
      code: "INVALID_PROJECTION",
      message: `Skill projection failed during construction: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  if (input.schemaProjectionCompleteness !== undefined) {
    try {
      projectProductSchemas(product, input.schemaProjectionCompleteness);
    } catch (error) {
      if (error instanceof SchemaProjectionError) {
        projectionIssues.push({
          code: "UNSUPPORTED_SCHEMA_PROJECTION",
          message: error.message,
        });
      } else {
        throw error;
      }
    }
  }

  if (projectionIssues.length > 0) throw new CanonConstructionError(projectionIssues);
  return product;
}
