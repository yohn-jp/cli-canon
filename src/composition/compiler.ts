import type { CompiledField, CompiledProduct } from "../command/compiler.js";
import { CanonConstructionError, type CanonConstructionIssue } from "../command/errors.js";
import type { CommandVisibility } from "../command/model.js";
import type { CommandTreeChildNode } from "../command/tree.js";
import type { ProductPackageIdentity } from "../product/identity.js";
import type { ResolvedCommandProjection } from "../projection/discovery.js";
import type { HelpTreeChild } from "../projection/help-model.js";
import type {
  CommandSource,
  CommandSourceId,
  CommandSourceKind,
  CommandSourceOwner,
  ComposedChildNode,
  ComposedCommandNode,
  ComposedCommandTree,
} from "./model.js";

type Route = readonly [string, ...string[]];

interface Presentation {
  readonly summary: string;
  readonly description?: string;
  readonly visibility: CommandVisibility;
  readonly examples?: readonly string[];
}

interface Contribution {
  readonly kind: "group" | "command";
  readonly id: string;
  readonly route: Route;
  readonly owner: CommandSourceOwner;
  readonly presentation: Presentation;
  readonly fields?: readonly CompiledField[];
}

const FIELD_KINDS = new Set(["positional", "option", "flag", "raw-args"]);
const GROUP_EXECUTABLE_KEYS = ["fields", "input", "result", "orderedOptionGroups"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidId(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isValidRoute(route: unknown): route is Route {
  return (
    Array.isArray(route) &&
    route.length > 0 &&
    route.every((segment) => typeof segment === "string" && segment.trim() !== "" && !/\s/u.test(segment))
  );
}

function routeKey(route: readonly string[]): string {
  return route.join("\u0000");
}

function compareRoutes(left: readonly string[], right: readonly string[]): number {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const leftSegment = left[index] as string;
    const rightSegment = right[index] as string;
    if (leftSegment !== rightSegment) return leftSegment < rightSegment ? -1 : 1;
  }
  return left.length - right.length;
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareContributions(left: Contribution, right: Contribution): number {
  return (
    compareRoutes(left.route, right.route) ||
    // Groups sort before commands on the same route so a structural group is never
    // displaced by a conflicting leaf claim.
    compareIds(right.kind, left.kind) ||
    compareIds(left.id, right.id) ||
    compareIds(left.owner.sourceId, right.owner.sourceId)
  );
}

function nodeIssueIds(entry: Contribution): { readonly commandId: string } | { readonly groupId: string } {
  return entry.kind === "command" ? { commandId: entry.id } : { groupId: entry.id };
}

function describe(entry: Contribution): string {
  return `${entry.kind} ${entry.id} from source ${entry.owner.sourceId}`;
}

function freezeFields(fields: readonly CompiledField[]): readonly CompiledField[] {
  return Object.freeze(
    fields.map((field) =>
      Object.freeze({
        ...field,
        ...(field.aliases === undefined ? {} : { aliases: Object.freeze([...field.aliases]) }),
      }),
    ),
  );
}

function presentation(
  value: {
    readonly summary: string;
    readonly description?: string;
    readonly visibility?: CommandVisibility;
    readonly examples?: readonly string[];
  },
  visibility: CommandVisibility = value.visibility ?? "public",
): Presentation {
  return {
    summary: value.summary,
    ...(value.description === undefined ? {} : { description: value.description }),
    visibility,
    ...(value.examples === undefined ? {} : { examples: Object.freeze([...value.examples]) }),
  };
}

function canonicalContributions(
  sourceId: string,
  product: unknown,
  issues: CanonConstructionIssue[],
): readonly Contribution[] {
  if (
    !isRecord(product) ||
    !isRecord(product.tree) ||
    product.tree.kind !== "root" ||
    !Array.isArray(product.tree.children) ||
    !Array.isArray(product.commands)
  ) {
    issues.push({
      code: "INVALID_COMMAND_SOURCE",
      sourceId,
      message: `source ${sourceId}: canonical sources must provide a compiled product`,
    });
    return [];
  }
  const compiled = product as unknown as CompiledProduct;
  const commandsById = new Map(compiled.commands.map((command) => [command.id, command]));
  const owner: CommandSourceOwner = Object.freeze({ kind: "canonical", sourceId });
  const contributions: Contribution[] = [];
  const visit = (nodes: readonly CommandTreeChildNode[]): void => {
    for (const node of nodes) {
      if (node.kind === "group") {
        contributions.push({
          kind: "group",
          id: node.id,
          route: Object.freeze([...node.route]) as unknown as Route,
          owner,
          presentation: presentation(node.definition),
        });
        visit(node.children);
        continue;
      }
      const command = commandsById.get(node.id);
      if (command === undefined) {
        issues.push({
          code: "INVALID_COMMAND_SOURCE",
          sourceId,
          commandId: node.id,
          message: `source ${sourceId}: canonical tree command ${node.id} has no compiled command`,
        });
        continue;
      }
      contributions.push({
        kind: "command",
        id: command.id,
        route: Object.freeze([...command.route]) as unknown as Route,
        owner,
        presentation: presentation(command, command.visibility),
        fields: command.fields,
      });
    }
  };
  visit(compiled.tree.children);
  return contributions;
}

function validFields(value: unknown): value is readonly CompiledField[] {
  return (
    Array.isArray(value) &&
    value.every((field) => isRecord(field) && isValidId(field.key) && FIELD_KINDS.has(field.kind as string))
  );
}

function validPresentation(value: Record<string, unknown>): boolean {
  return (
    typeof value.summary === "string" &&
    (value.description === undefined || typeof value.description === "string") &&
    (value.visibility === undefined || value.visibility === "public" || value.visibility === "private") &&
    (value.examples === undefined ||
      (Array.isArray(value.examples) && value.examples.every((example) => typeof example === "string")))
  );
}

function delegatedContributions(
  sourceId: string,
  source: Record<string, unknown>,
  issues: CanonConstructionIssue[],
): readonly Contribution[] {
  const owner: CommandSourceOwner = Object.freeze({ kind: "delegated", sourceId });
  const contributions: Contribution[] = [];
  if (source.groups !== undefined && !Array.isArray(source.groups)) {
    issues.push({
      code: "INVALID_COMMAND_SOURCE",
      sourceId,
      message: `source ${sourceId}: delegated groups must be an array of group descriptors`,
    });
  }
  if (!Array.isArray(source.commands)) {
    issues.push({
      code: "INVALID_COMMAND_SOURCE",
      sourceId,
      message: `source ${sourceId}: delegated commands must be an array of command descriptors`,
    });
  }
  const groups: readonly unknown[] = Array.isArray(source.groups) ? source.groups : [];
  const commands: readonly unknown[] = Array.isArray(source.commands) ? source.commands : [];

  for (const value of groups) {
    if (!isRecord(value) || !isValidId(value.id)) {
      issues.push({
        code: "INVALID_GROUP_DECLARATION",
        sourceId,
        message: `source ${sourceId}: group descriptors must be objects with a non-empty id`,
      });
      continue;
    }
    const groupId = value.id;
    let valid = true;
    if (!isValidRoute(value.route)) {
      issues.push({
        code: "INVALID_ROUTE",
        sourceId,
        groupId,
        message: `source ${sourceId}: group ${groupId} route segments must be non-empty single tokens`,
      });
      valid = false;
    }
    if (!validPresentation(value)) {
      issues.push({
        code: "INVALID_GROUP_DECLARATION",
        sourceId,
        groupId,
        message: `source ${sourceId}: group ${groupId} has invalid summary, description, visibility, or examples`,
      });
      valid = false;
    }
    for (const key of GROUP_EXECUTABLE_KEYS) {
      if (Object.hasOwn(value, key)) {
        issues.push({
          code: "INVALID_GROUP_DECLARATION",
          sourceId,
          groupId,
          message: `source ${sourceId}: group ${groupId} is non-executable and cannot declare ${key}`,
        });
        valid = false;
      }
    }
    if (!valid) continue;
    const group = value as unknown as Parameters<typeof presentation>[0] & { readonly route: Route };
    contributions.push({
      kind: "group",
      id: groupId,
      route: Object.freeze([...group.route]) as unknown as Route,
      owner,
      presentation: presentation(group),
    });
  }

  for (const value of commands) {
    if (!isRecord(value) || !isValidId(value.id)) {
      issues.push({
        code: "INVALID_COMMAND_SOURCE",
        sourceId,
        message: `source ${sourceId}: command descriptors must be objects with a non-empty id`,
      });
      continue;
    }
    const commandId = value.id;
    let valid = true;
    if (!isValidRoute(value.route)) {
      issues.push({
        code: "INVALID_ROUTE",
        sourceId,
        commandId,
        message: `source ${sourceId}: command ${commandId} route segments must be non-empty single tokens`,
      });
      valid = false;
    }
    if (!validPresentation(value)) {
      issues.push({
        code: "INVALID_COMMAND_SOURCE",
        sourceId,
        commandId,
        message: `source ${sourceId}: command ${commandId} has invalid summary, description, visibility, or examples`,
      });
      valid = false;
    }
    if (!validFields(value.fields)) {
      issues.push({
        code: "INVALID_COMMAND_SOURCE",
        sourceId,
        commandId,
        message: `source ${sourceId}: command ${commandId} fields must be compiled field descriptors`,
      });
      valid = false;
    }
    if (!valid) continue;
    const command = value as unknown as Parameters<typeof presentation>[0] & {
      readonly route: Route;
      readonly fields: readonly CompiledField[];
    };
    contributions.push({
      kind: "command",
      id: commandId,
      route: Object.freeze([...command.route]) as unknown as Route,
      owner,
      presentation: presentation(command),
      fields: command.fields,
    });
  }
  return contributions;
}

/**
 * Composes canonical and delegated command sources into one resolved tree with
 * explicit, deterministic route ownership. Composition is purely structural:
 * it never invokes handlers or delegated executors. Every ownership conflict is
 * reported as a construction issue and the tree is returned only when there are
 * no issues at all. Results are independent of source declaration order.
 */
export function composeCommandSources<const Sources extends readonly CommandSource[]>(
  sources: Sources,
): ComposedCommandTree<CommandSourceId<Sources>> {
  const issues: CanonConstructionIssue[] = [];
  if (!Array.isArray(sources)) {
    throw new CanonConstructionError([{ code: "INVALID_COMMAND_SOURCE", message: "command sources must be an array" }]);
  }

  const accepted: {
    readonly id: string;
    readonly kind: CommandSourceKind;
    readonly source: Record<string, unknown>;
  }[] = [];
  const seenSourceIds = new Set<string>();
  for (const source of sources as readonly unknown[]) {
    if (!isRecord(source) || !isValidId(source.id)) {
      issues.push({
        code: "INVALID_COMMAND_SOURCE",
        message: "command sources must be objects with a non-empty id",
      });
      continue;
    }
    const sourceId = source.id;
    if (source.kind !== "canonical" && source.kind !== "delegated") {
      issues.push({
        code: "INVALID_COMMAND_SOURCE",
        sourceId,
        message: `source ${sourceId}: kind must be canonical or delegated`,
      });
      continue;
    }
    if (seenSourceIds.has(sourceId)) {
      issues.push({
        code: "DUPLICATE_COMMAND_SOURCE",
        sourceId,
        message: `source ${sourceId}: source ID is declared more than once`,
      });
      continue;
    }
    seenSourceIds.add(sourceId);
    accepted.push({ id: sourceId, kind: source.kind, source });
  }
  accepted.sort((left, right) => compareIds(left.id, right.id));

  const entries: Contribution[] = accepted.flatMap(({ id, kind, source }) =>
    kind === "canonical"
      ? canonicalContributions(id, source.product, issues)
      : delegatedContributions(id, source, issues),
  );
  // Conflicts are resolved in canonical route order, not source declaration order,
  // so which contribution is reported as the conflict is deterministic.
  entries.sort(compareContributions);

  const nodesById = new Map<string, Contribution>();
  const owners = new Map<string, Contribution>();
  const resolved: Contribution[] = [];
  for (const entry of entries) {
    const sameId = nodesById.get(entry.id);
    if (sameId !== undefined) {
      issues.push({
        code: sameId.kind === "command" && entry.kind === "command" ? "DUPLICATE_COMMAND_ID" : "DUPLICATE_NODE_ID",
        sourceId: entry.owner.sourceId,
        ...nodeIssueIds(entry),
        message: `${describe(entry)}: node ID duplicates ${describe(sameId)}`,
      });
    } else {
      nodesById.set(entry.id, entry);
    }
    const key = routeKey(entry.route);
    const owner = owners.get(key);
    if (owner === undefined) {
      owners.set(key, entry);
      resolved.push(entry);
    } else {
      issues.push({
        code: owner.kind === entry.kind ? "DUPLICATE_ROUTE" : "AMBIGUOUS_ROUTE_OWNERSHIP",
        sourceId: entry.owner.sourceId,
        ...nodeIssueIds(entry),
        message: `${describe(entry)}: route ${entry.route.join(" ")} is already owned by ${describe(owner)}`,
      });
    }
  }

  // A node belongs to the group owning its longest proper route prefix, or to the root,
  // regardless of which source declared that group.
  const children = new Map<string | undefined, Contribution[]>();
  for (const entry of resolved) {
    let parentId: string | undefined;
    for (let length = entry.route.length - 1; length > 0; length -= 1) {
      const owner = owners.get(routeKey(entry.route.slice(0, length)));
      if (owner === undefined) continue;
      if (owner.kind === "command") {
        issues.push({
          code: "INVALID_PARENT",
          sourceId: entry.owner.sourceId,
          ...nodeIssueIds(entry),
          message: `${describe(entry)}: route ${entry.route.join(" ")} is nested under ${describe(owner)}; commands cannot own children`,
        });
      } else {
        parentId = owner.id;
      }
      break;
    }
    const siblings = children.get(parentId);
    if (siblings === undefined) children.set(parentId, [entry]);
    else siblings.push(entry);
  }

  if (issues.length > 0) throw new CanonConstructionError(issues);

  function build(parentId: string | undefined): readonly ComposedChildNode[] {
    const siblings = [...(children.get(parentId) ?? [])].sort((left, right) => compareRoutes(left.route, right.route));
    return Object.freeze(
      siblings.map((entry): ComposedChildNode => {
        const common = { id: entry.id, route: entry.route, owner: entry.owner, ...entry.presentation };
        return entry.kind === "group"
          ? Object.freeze({ kind: "group" as const, ...common, children: build(entry.id) })
          : Object.freeze({ kind: "command" as const, ...common, fields: freezeFields(entry.fields ?? []) });
      }),
    );
  }

  const tree: ComposedCommandTree = Object.freeze({
    sources: Object.freeze(accepted.map(({ id, kind }) => Object.freeze({ kind, sourceId: id }))),
    root: Object.freeze({ kind: "root" as const, children: build(undefined) }),
  });
  return tree as ComposedCommandTree<CommandSourceId<Sources>>;
}

/** Product identity carried by the structural projection of a composed tree. */
export interface ComposedProjectionIdentity {
  readonly name: string;
  readonly packageMetadata?: ProductPackageIdentity;
}

function helpTreeChildren(nodes: readonly ComposedChildNode[]): readonly HelpTreeChild[] {
  return nodes.map((node): HelpTreeChild => {
    if (node.kind === "command") return { kind: "command", id: node.id };
    return {
      kind: "group",
      id: node.id,
      route: node.route,
      definition: {
        summary: node.summary,
        ...(node.description === undefined ? {} : { description: node.description }),
        ...(node.examples === undefined ? {} : { examples: node.examples }),
      },
      children: helpTreeChildren(node.children),
    };
  });
}

function composedCommands(nodes: readonly ComposedChildNode[]): readonly ComposedCommandNode[] {
  return nodes.flatMap((node) => (node.kind === "command" ? [node] : composedCommands(node.children)));
}

/**
 * Projects a composed tree to the structural help/discovery product surface.
 * Every source contributes only its declared structure; no source is executed.
 */
export function projectComposedCommandTree(
  tree: ComposedCommandTree,
  identity: ComposedProjectionIdentity,
): ResolvedCommandProjection {
  return Object.freeze({
    name: identity.name,
    ...(identity.packageMetadata === undefined ? {} : { packageMetadata: identity.packageMetadata }),
    tree: Object.freeze({ children: helpTreeChildren(tree.root.children) }),
    commands: Object.freeze(composedCommands(tree.root.children)),
  });
}
