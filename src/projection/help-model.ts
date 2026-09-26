import type { CompiledField } from "../command/compiler.js";
import type { ProjectionCommandSource, ProjectionProductSource } from "./source.js";

/** Structural read view of the resolved canonical or composed command tree used by the help model. */
export interface HelpTreeSource {
  readonly children: readonly HelpTreeChild[];
}

export type HelpTreeChild =
  | { readonly kind: "command"; readonly id: string }
  | {
      readonly kind: "group";
      readonly id: string;
      readonly route: readonly string[];
      readonly definition: {
        readonly summary: string;
        readonly description?: string;
        readonly examples?: readonly string[];
      };
      readonly children: readonly HelpTreeChild[];
    };

/**
 * Product input of the canonical help model. The tree determines route and
 * group membership. Commands absent from it are supported only by the
 * deprecated `composeCommandProjection` compatibility path.
 */
export interface HelpModelProduct extends ProjectionProductSource {
  readonly tree?: HelpTreeSource;
}

/** An explicit help target. Undeclared route prefixes are never targets. */
export type HelpTarget =
  | { readonly kind: "root" }
  | { readonly kind: "group"; readonly id: string; readonly route: readonly string[] }
  | { readonly kind: "command"; readonly id: string; readonly route: readonly string[] };

/**
 * Human help detail level of one help document.
 *
 * - `summary`: usage, target summary, and child summaries.
 * - `full`: `summary` plus target description, arguments, options, child
 *   descriptions, and examples.
 *
 * JSON help is not a document mode: it is the discovery projection of the same
 * document's `commands`.
 */
export type HelpDocumentMode = "summary" | "full";

export interface HelpFieldEntry {
  readonly key: string;
  readonly kind: CompiledField["kind"];
  /** Presentation label derived from the declared field grammar. */
  readonly label: string;
  readonly description?: string;
}

export interface HelpChildEntry {
  readonly kind: "group" | "command";
  readonly id: string;
  readonly route: readonly string[];
  /** Route segments below the target route. */
  readonly name: string;
  readonly summary: string;
  readonly description?: string;
}

/** One semantic help document for a root, group, or command target. */
export interface HelpDocument {
  readonly mode: HelpDocumentMode;
  readonly productName: string;
  readonly target: HelpTarget;
  /** Usage tokens derived from the route tree and declared field grammar. */
  readonly usage: readonly string[];
  readonly summary?: string;
  readonly description?: string;
  readonly arguments: readonly HelpFieldEntry[];
  readonly options: readonly HelpFieldEntry[];
  readonly children: readonly HelpChildEntry[];
  readonly examples: readonly string[];
  /** Command leaves of the target subtree in canonical tree order; the JSON help source. */
  readonly commands: readonly ProjectionCommandSource[];
}

interface HelpNode {
  readonly kind: "root" | "group" | "command";
  readonly id: string;
  readonly route: readonly string[];
  readonly summary?: string;
  readonly description?: string;
  readonly examples?: readonly string[];
  readonly command?: ProjectionCommandSource;
  readonly children: HelpNode[];
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

function compareNodes(left: HelpNode, right: HelpNode): number {
  return compareRoutes(left.route, right.route) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

function commandNode(command: ProjectionCommandSource): HelpNode {
  return {
    kind: "command",
    id: command.id,
    route: command.route,
    summary: command.summary,
    ...(command.description === undefined ? {} : { description: command.description }),
    ...(command.examples === undefined ? {} : { examples: command.examples }),
    command,
    children: [],
  };
}

function buildHelpTree(product: HelpModelProduct): {
  readonly root: HelpNode;
  readonly nodes: ReadonlyMap<string, HelpNode>;
} {
  const commandsById = new Map(product.commands.map((command) => [command.id, command]));
  const nodes = new Map<string, HelpNode>();
  const groups: HelpNode[] = [];
  const treeCommandIds = new Set<string>();
  const root: HelpNode = {
    kind: "root",
    id: "",
    route: [],
    ...(product.description === undefined ? {} : { summary: product.description }),
    children: [],
  };

  function attach(parent: HelpNode, children: readonly HelpTreeChild[]): void {
    for (const child of children) {
      if (child.kind === "command") {
        const command = commandsById.get(child.id);
        if (command === undefined) continue;
        treeCommandIds.add(command.id);
        const node = commandNode(command);
        nodes.set(routeKey(node.route), node);
        parent.children.push(node);
        continue;
      }
      const node: HelpNode = {
        kind: "group",
        id: child.id,
        route: child.route,
        summary: child.definition.summary,
        ...(child.definition.description === undefined ? {} : { description: child.definition.description }),
        ...(child.definition.examples === undefined ? {} : { examples: child.definition.examples }),
        children: [],
      };
      nodes.set(routeKey(node.route), node);
      groups.push(node);
      parent.children.push(node);
      attach(node, child.children);
    }
  }
  attach(root, product.tree?.children ?? []);

  const touched = new Set<HelpNode>();
  for (const command of product.commands) {
    if (treeCommandIds.has(command.id)) continue;
    let parent = root;
    for (const group of groups) {
      if (
        group.route.length < command.route.length &&
        group.route.length > parent.route.length &&
        group.route.every((segment, index) => command.route[index] === segment)
      ) {
        parent = group;
      }
    }
    const node = commandNode(command);
    nodes.set(routeKey(node.route), node);
    parent.children.push(node);
    touched.add(parent);
  }
  for (const parent of touched) parent.children.sort(compareNodes);
  return { root, nodes };
}

function fieldNames(field: CompiledField): string {
  return [...(field.aliases ?? []), field.flag].join(", ");
}

/** Usage notation of one declared field. */
export function fieldSyntax(field: CompiledField): string {
  if (field.kind === "flag") return `[${fieldNames(field)}]`;
  if (field.kind === "option") {
    const value = `<${field.metavar ?? field.key}>${field.repeatable === true ? "..." : ""}`;
    const syntax = `${fieldNames(field)}${field.valueArity === "optional" ? `[=${value}]` : ` ${value}`}`;
    return field.required === true ? syntax : `[${syntax}]`;
  }
  if (field.kind === "positional") {
    const value = `<${field.metavar ?? field.key}>`;
    return field.required === false ? `[${value}]` : value;
  }
  return "[-- <args...>]";
}

function fieldEntry(field: CompiledField, label: string): HelpFieldEntry {
  return {
    key: field.key,
    kind: field.kind,
    label,
    ...(field.description === undefined ? {} : { description: field.description }),
  };
}

function descendantCommands(node: HelpNode): readonly ProjectionCommandSource[] {
  if (node.command !== undefined) return [node.command];
  return node.children.flatMap(descendantCommands);
}

/** Resolves an explicit help target from a route; undefined when no root/group/command owns it. */
export function resolveHelpTarget(product: HelpModelProduct, route: readonly string[]): HelpTarget | undefined {
  if (route.length === 0) return { kind: "root" };
  const node = buildHelpTree(product).nodes.get(routeKey(route));
  if (node === undefined) return undefined;
  return node.kind === "command"
    ? { kind: "command", id: node.id, route: node.route }
    : { kind: "group", id: node.id, route: node.route };
}

/** A group or command help target together with the declared fields of a command target. */
export interface HelpTargetScope {
  readonly target: Exclude<HelpTarget, { readonly kind: "root" }>;
  readonly fields: readonly CompiledField[];
}

/** Every group and command help target in canonical tree order, from one resolved tree. */
export function helpTargetScopes(product: HelpModelProduct): readonly HelpTargetScope[] {
  const scopes: HelpTargetScope[] = [];
  const visit = (node: HelpNode): void => {
    for (const child of node.children) {
      scopes.push({
        target: { kind: child.kind === "command" ? "command" : "group", id: child.id, route: child.route },
        fields: child.command?.fields ?? [],
      });
      visit(child);
    }
  };
  visit(buildHelpTree(product).root);
  return scopes;
}

/** Projects the one semantic help document for a target from the canonical tree. */
export function projectHelpDocument(
  product: HelpModelProduct,
  target: HelpTarget,
  mode: HelpDocumentMode = "summary",
): HelpDocument | undefined {
  const tree = buildHelpTree(product);
  const node = target.kind === "root" ? tree.root : tree.nodes.get(routeKey(target.route));
  if (node === undefined || node.kind !== target.kind || (target.kind !== "root" && node.id !== target.id)) {
    return undefined;
  }
  const full = mode === "full";
  const fields = node.command?.fields ?? [];
  const children = node.children.map((child): HelpChildEntry => ({
    kind: child.kind === "group" ? "group" : "command",
    id: child.id,
    route: child.route,
    name: child.route.slice(node.route.length).join(" "),
    summary: child.summary ?? "",
    ...(full && child.description !== undefined ? { description: child.description } : {}),
  }));
  return {
    mode,
    productName: product.name,
    target,
    usage:
      node.command === undefined
        ? [product.name, ...node.route, "<command>"]
        : [product.name, ...node.route, ...fields.map(fieldSyntax)],
    ...(node.summary === undefined ? {} : { summary: node.summary }),
    ...(full && node.description !== undefined ? { description: node.description } : {}),
    arguments: full
      ? fields
          .filter((field) => field.kind === "positional" || field.kind === "raw-args")
          .map((field) => fieldEntry(field, fieldSyntax(field)))
      : [],
    options: full
      ? fields
          .filter((field) => field.kind === "option" || field.kind === "flag")
          .map((field) => fieldEntry(field, field.kind === "flag" ? fieldNames(field) : fieldSyntax(field)))
      : [],
    children,
    examples: full ? [...(node.examples ?? [])] : [],
    commands: descendantCommands(node),
  };
}
