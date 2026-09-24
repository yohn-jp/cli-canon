import type { CanonConstructionIssue } from "./errors.js";
import type { CommandCatalog, CommandDefinition, CommandId, GroupCatalog, GroupDefinition, GroupId } from "./model.js";

/** Explicit structural node kinds of a canonical command tree. */
export type CommandTreeNodeKind = "root" | "group" | "command";

/** An executable leaf referencing exactly one declared command. */
export interface CommandTreeCommandNode<
  Commands extends CommandCatalog = CommandCatalog,
  Id extends CommandId<Commands> = CommandId<Commands>,
> {
  readonly kind: "command";
  readonly id: Id;
  readonly route: Commands[Id]["route"];
  readonly definition: Commands[Id];
}

/** A non-executable route group referencing exactly one declared group. */
export interface CommandTreeGroupNode<
  Groups extends GroupCatalog = GroupCatalog,
  Commands extends CommandCatalog = CommandCatalog,
  Id extends GroupId<Groups> = GroupId<Groups>,
> {
  readonly kind: "group";
  readonly id: Id;
  readonly route: Groups[Id]["route"];
  readonly definition: Groups[Id];
  readonly children: readonly CommandTreeChildNode<Groups, Commands>[];
}

export type CommandTreeChildNode<
  Groups extends GroupCatalog = GroupCatalog,
  Commands extends CommandCatalog = CommandCatalog,
> =
  | { readonly [Id in GroupId<Groups>]: CommandTreeGroupNode<Groups, Commands, Id> }[GroupId<Groups>]
  | { readonly [Id in CommandId<Commands>]: CommandTreeCommandNode<Commands, Id> }[CommandId<Commands>];

/** The product root. It has no route of its own and is not executable. */
export interface CommandTreeRootNode<
  Groups extends GroupCatalog = GroupCatalog,
  Commands extends CommandCatalog = CommandCatalog,
> {
  readonly kind: "root";
  readonly children: readonly CommandTreeChildNode<Groups, Commands>[];
}

export type CommandTreeNode<
  Groups extends GroupCatalog = GroupCatalog,
  Commands extends CommandCatalog = CommandCatalog,
> = CommandTreeRootNode<Groups, Commands> | CommandTreeChildNode<Groups, Commands>;

interface TreeEntry {
  readonly kind: "group" | "command";
  readonly id: string;
  readonly definition: GroupDefinition | CommandDefinition;
}

interface RouteOwner {
  readonly kind: "group" | "command";
  readonly id: string;
}

const EXECUTABLE_KEYS = ["input", "result", "orderedOptionGroups"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidRoute(route: unknown): route is readonly [string, ...string[]] {
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

function nodeIssueIds(entry: TreeEntry): { readonly commandId: string } | { readonly groupId: string } {
  return entry.kind === "command" ? { commandId: entry.id } : { groupId: entry.id };
}

function snapshotGroup(groupId: string, value: unknown, issues: CanonConstructionIssue[]): GroupDefinition | undefined {
  if (!isRecord(value)) {
    issues.push({
      code: "INVALID_GROUP_DECLARATION",
      groupId,
      message: `${groupId}: group declaration must be an object`,
    });
    return undefined;
  }
  let valid = true;
  if (!isValidRoute(value.route)) {
    issues.push({
      code: "INVALID_ROUTE",
      groupId,
      message: `${groupId}: route segments must be non-empty single tokens`,
    });
    valid = false;
  }
  if (value.visibility !== undefined && value.visibility !== "public" && value.visibility !== "private") {
    issues.push({
      code: "INVALID_GROUP_DECLARATION",
      groupId,
      message: `${groupId}: visibility must be public or private`,
    });
    valid = false;
  }
  for (const key of EXECUTABLE_KEYS) {
    if (Object.hasOwn(value, key)) {
      issues.push({
        code: "INVALID_GROUP_DECLARATION",
        groupId,
        message: `${groupId}: groups are non-executable and cannot declare ${key}`,
      });
      valid = false;
    }
  }
  if (!valid) return undefined;
  const definition = value as unknown as GroupDefinition;
  return Object.freeze({
    route: Object.freeze([...definition.route]) as GroupDefinition["route"],
    summary: definition.summary,
    ...(definition.description === undefined ? {} : { description: definition.description }),
    ...(definition.visibility === undefined ? {} : { visibility: definition.visibility }),
    ...(definition.examples === undefined ? {} : { examples: Object.freeze([...definition.examples]) }),
  });
}

/**
 * Compiles group declarations and snapshotted command definitions into the one
 * canonical command tree. Every structural conflict is reported as an issue; the
 * tree is returned only when construction has no issues at all.
 */
export function compileCommandTree(
  groups: unknown,
  commands: readonly { readonly id: string; readonly definition: CommandDefinition }[],
  issues: CanonConstructionIssue[],
): CommandTreeRootNode | undefined {
  const entries: TreeEntry[] = [];
  if (groups !== undefined && !isRecord(groups)) {
    issues.push({
      code: "INVALID_GROUP_DECLARATION",
      message: "groups must be an object mapping group IDs to group declarations",
    });
  } else if (groups !== undefined) {
    for (const [groupId, value] of Object.entries(groups)) {
      const definition = snapshotGroup(groupId, value, issues);
      if (definition !== undefined) entries.push({ kind: "group", id: groupId, definition });
    }
  }

  const commandIds = new Set(commands.map((command) => command.id));
  const owners = new Map<string, RouteOwner>();
  for (const command of commands) {
    const key = routeKey(command.definition.route);
    if (!owners.has(key)) owners.set(key, { kind: "command", id: command.id });
  }
  for (const group of entries) {
    if (commandIds.has(group.id)) {
      issues.push({
        code: "DUPLICATE_NODE_ID",
        groupId: group.id,
        commandId: group.id,
        message: `${group.id}: group ID duplicates a command ID`,
      });
    }
    const key = routeKey(group.definition.route);
    const owner = owners.get(key);
    if (owner === undefined) {
      owners.set(key, { kind: "group", id: group.id });
    } else if (owner.kind === "command") {
      issues.push({
        code: "AMBIGUOUS_ROUTE_OWNERSHIP",
        groupId: group.id,
        commandId: owner.id,
        message: `${group.id}: group route is also claimed by command ${owner.id}: ${group.definition.route.join(" ")}`,
      });
    } else {
      issues.push({
        code: "DUPLICATE_ROUTE",
        groupId: group.id,
        message: `${group.id}: route duplicates group ${owner.id}: ${group.definition.route.join(" ")}`,
      });
    }
  }
  for (const command of commands) entries.push({ kind: "command", id: command.id, definition: command.definition });

  // A node belongs to the declared group owning its longest proper route prefix, or to the root.
  const children = new Map<string | undefined, TreeEntry[]>();
  for (const entry of entries) {
    const route = entry.definition.route;
    if (!isValidRoute(route)) continue;
    let parentId: string | undefined;
    for (let length = route.length - 1; length > 0; length -= 1) {
      const owner = owners.get(routeKey(route.slice(0, length)));
      if (owner === undefined) continue;
      if (owner.kind === "command") {
        issues.push({
          code: "INVALID_PARENT",
          ...nodeIssueIds(entry),
          message: `${entry.id}: route ${route.join(" ")} is nested under command ${owner.id}; commands cannot own children`,
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

  if (issues.length > 0) return undefined;

  function build(parentId: string | undefined): readonly CommandTreeChildNode[] {
    const siblings = [...(children.get(parentId) ?? [])].sort((left, right) =>
      compareRoutes(left.definition.route, right.definition.route),
    );
    return Object.freeze(
      siblings.map((entry) =>
        entry.kind === "group"
          ? Object.freeze({
              kind: "group" as const,
              id: entry.id,
              route: entry.definition.route,
              definition: entry.definition as GroupDefinition,
              children: build(entry.id),
            })
          : Object.freeze({
              kind: "command" as const,
              id: entry.id,
              route: entry.definition.route,
              definition: entry.definition as CommandDefinition,
            }),
      ),
    );
  }

  return Object.freeze({ kind: "root" as const, children: build(undefined) });
}

/** Command leaves of a compiled tree in canonical depth-first order. */
export function commandTreeCommands(
  node: CommandTreeRootNode | CommandTreeGroupNode,
): readonly CommandTreeCommandNode[] {
  return node.children.flatMap((child) => (child.kind === "command" ? [child] : commandTreeCommands(child)));
}
