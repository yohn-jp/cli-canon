import type { CommandCatalog, CommandDefinition, CommandId, FieldDefinition } from "../command/model.js";
import type { CommandTreeChildNode, CommandTreeCommandNode, CommandTreeRootNode } from "../command/tree.js";
import type { ComposedCommandNode } from "../composition/model.js";
import type { PresentationMode } from "../output/model.js";
import type { ProductPackageIdentity } from "../product/identity.js";
import type { ParsedHelpMode } from "../projection/help.js";
import { parsedHelpFromScan, scanShellArgv } from "../projection/shell-scan.js";
import {
  CanonicalRequestError,
  type CanonicalArgvOutcome,
  type CanonicalArgvRequest,
  type CanonicalCommandRequest,
  type CanonicalExecutionOutcome,
  type CanonicalRuntimeProduct,
  type CanonicalUsageFailure,
  type ComposedArgvOutcome,
  type ComposedRuntimeProduct,
} from "./model.js";

type RouteResolution =
  | { readonly kind: "command"; readonly node: CommandTreeCommandNode }
  | { readonly kind: "not-executable" }
  | { readonly kind: "not-found" };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isRoutePrefix(prefix: readonly string[], route: readonly string[]): boolean {
  return prefix.length <= route.length && prefix.every((segment, index) => route[index] === segment);
}

/** Resolves a route by walking the compiled canonical tree; routes are matched exactly. */
function resolveRoute(tree: CommandTreeRootNode, route: readonly string[]): RouteResolution {
  if (route.length === 0) return { kind: "not-executable" };
  let children: readonly CommandTreeChildNode[] = tree.children;
  for (;;) {
    const next = children.find((child) => isRoutePrefix(child.route, route));
    if (next === undefined) return { kind: "not-found" };
    if (next.route.length === route.length) {
      return next.kind === "command" ? { kind: "command", node: next } : { kind: "not-executable" };
    }
    if (next.kind === "command") return { kind: "not-found" };
    children = next.children;
  }
}

function isOptionToken(field: Extract<FieldDefinition, { kind: "option" }>, value: unknown): boolean {
  return typeof value === "string" || (field.valueArity === "optional" && value === true);
}

function assertRequestTokens(definition: CommandDefinition, input: unknown): asserts input is Record<string, unknown> {
  if (!isRecord(input)) throw new CanonicalRequestError("canonical request input must be an object");
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(definition.input, key)) {
      throw new CanonicalRequestError(`unknown canonical request field ${key}`, key);
    }
    if (value === undefined) continue;
    const field = definition.input[key] as FieldDefinition;
    const valid =
      field.kind === "positional"
        ? typeof value === "string"
        : field.kind === "flag"
          ? typeof value === "boolean"
          : field.kind === "raw-args"
            ? Array.isArray(value) && value.every((item) => typeof item === "string")
            : field.repeatable
              ? Array.isArray(value) && value.every((item) => isOptionToken(field, item))
              : isOptionToken(field, value);
    if (!valid)
      throw new CanonicalRequestError(`canonical request field ${key} has an invalid ${field.kind} token`, key);
  }
}

function missingRequiredInput(
  node: CommandTreeCommandNode,
  input: Readonly<Record<string, unknown>>,
  route: readonly string[],
): CanonicalUsageFailure | undefined {
  for (const [key, field] of Object.entries(node.definition.input)) {
    const value = input[key];
    if (field.kind === "positional" && field.required && value === undefined) {
      return { code: "missing-positional-argument", route, commandId: node.id, field: key };
    }
    if (field.kind !== "option" || !field.required) continue;
    if (field.repeatable ? !Array.isArray(value) || value.length === 0 : value === undefined) {
      return { code: "missing-required-option", route, commandId: node.id, field: key, option: field.flag };
    }
  }
  return undefined;
}

class FieldDecodeError {
  readonly field: string;
  readonly error: unknown;

  constructor(field: string, error: unknown) {
    this.field = field;
    this.error = error;
  }
}

async function decodeField(field: FieldDefinition, value: unknown): Promise<unknown> {
  if (field.kind === "flag") return value === true;
  if (field.kind === "raw-args") return Object.freeze([...((value as readonly string[] | undefined) ?? [])]);
  if (field.kind === "option" && field.repeatable) {
    const decoded: unknown[] = [];
    for (const item of (value as readonly unknown[] | undefined) ?? []) {
      decoded.push(item === true && field.valueArity === "optional" ? undefined : await field.schema.parseAsync(item));
    }
    return Object.freeze(decoded);
  }
  if (value === undefined && !field.required) return undefined;
  if (field.kind === "option" && value === true && field.valueArity === "optional") return undefined;
  return field.schema.parseAsync(value);
}

/** Decodes declared fields in declaration order; the first schema failure is reported with its field key. */
async function decodeInput(
  definition: CommandDefinition,
  input: Readonly<Record<string, unknown>>,
): Promise<Readonly<Record<string, unknown>>> {
  const decoded: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(definition.input)) {
    try {
      decoded[key] = await decodeField(field, input[key]);
    } catch (error) {
      throw new FieldDecodeError(key, error);
    }
  }
  return Object.freeze(decoded);
}

/**
 * Executes one canonical command request against a compiled product.
 *
 * Resolution uses the compiled canonical tree, handlers receive only decoded input,
 * and returned values are validated against the declared result schema. The runtime
 * performs no terminal IO and never exits the process; every outcome is returned.
 */
export async function executeCanonicalCommand<const Catalog extends CommandCatalog>(
  product: CanonicalRuntimeProduct<Catalog>,
  request: CanonicalCommandRequest,
): Promise<CanonicalExecutionOutcome<Catalog>> {
  let route: readonly string[];
  let resolution: RouteResolution;
  try {
    if (!isRecord(request) || !Array.isArray(request.route) || request.route.some((s) => typeof s !== "string")) {
      throw new CanonicalRequestError("canonical request route must be a string array");
    }
    route = Object.freeze([...request.route]);
    resolution = resolveRoute(product.tree as unknown as CommandTreeRootNode, route);
  } catch (error) {
    return { status: "failure", failureKind: "unexpected", error };
  }

  if (resolution.kind !== "command") {
    return {
      status: "failure",
      failureKind: "usage",
      usageFailure: { code: resolution.kind === "not-found" ? "unknown-command" : "no-command", route },
    };
  }

  return executeCommandNode(product, resolution.node, route, request.input ?? {});
}

/** Validates, decodes, and executes request tokens against an already resolved command node. */
async function executeCommandNode<const Catalog extends CommandCatalog>(
  product: CanonicalRuntimeProduct<Catalog>,
  node: CommandTreeCommandNode,
  route: readonly string[],
  input: unknown,
): Promise<CanonicalExecutionOutcome<Catalog>> {
  const commandId = node.id as CommandId<Catalog>;
  try {
    assertRequestTokens(node.definition, input);
  } catch (error) {
    return { status: "failure", failureKind: "unexpected", commandId, error };
  }

  const missing = missingRequiredInput(node, input, route);
  if (missing !== undefined) return { status: "failure", failureKind: "usage", usageFailure: missing };

  let decoded: Readonly<Record<string, unknown>>;
  try {
    decoded = await decodeInput(node.definition, input);
  } catch (error) {
    if (error instanceof FieldDecodeError) {
      return { status: "failure", failureKind: "validation", commandId, field: error.field, error: error.error };
    }
    return { status: "failure", failureKind: "unexpected", commandId, error };
  }

  const handler: unknown = Object.hasOwn(product.handlers, commandId) ? product.handlers[commandId] : undefined;
  if (typeof handler !== "function") {
    return {
      status: "failure",
      failureKind: "unexpected",
      commandId,
      error: new CanonicalRequestError(`${commandId}: no handler is bound to the resolved command`),
    };
  }

  let rawResult: unknown;
  try {
    rawResult = await (handler as (input: Readonly<Record<string, unknown>>) => unknown)(decoded);
  } catch (error) {
    return { status: "failure", failureKind: "handler-error", commandId, error };
  }

  let result: unknown;
  try {
    result = await node.definition.result.parseAsync(rawResult);
  } catch (error) {
    return { status: "failure", failureKind: "handler-result", commandId, error };
  }

  return Object.freeze({
    status: "success",
    commandId,
    route: node.route,
    result,
  }) as CanonicalExecutionOutcome<Catalog>;
}

/** Structural route node shared by the compiled canonical tree and the composed source tree. */
type ArgvTreeNode =
  | { readonly kind: "command"; readonly route: readonly string[] }
  | { readonly kind: "group"; readonly route: readonly string[]; readonly children: readonly ArgvTreeNode[] };

type ArgvRouteResolution<Node, Failure, RootState> =
  | {
      readonly kind: "command";
      readonly node: Node;
      readonly route: readonly string[];
      readonly tail: readonly string[];
      readonly root: RootState;
    }
  | { readonly kind: "usage"; readonly usageFailure: CanonicalUsageFailure }
  | { readonly kind: "grammar"; readonly failure: Failure };

/**
 * Resolves the command route from argv operands against a route tree: the compiled
 * canonical tree or the composed source tree.
 *
 * The backend parses the options preceding each route operand; the runtime alone matches
 * operands to route segments and classifies unknown and incomplete routes.
 */
function resolveArgvRoute<Node extends ArgvTreeNode & { readonly kind: "command" }, Failure, RootState>(
  children: readonly ArgvTreeNode[],
  request: CanonicalArgvRequest<Failure, RootState>,
): ArgvRouteResolution<Node, Failure, RootState> {
  const leading = request.backend.parseLeading({ kind: "root" }, request.argv);
  if (leading.status === "failure") return { kind: "grammar", failure: leading.failure };
  const root = leading.state;
  let operands = leading.operands;
  let candidates: readonly ArgvTreeNode[] = children;
  const route: string[] = [];
  for (;;) {
    if (route.length > 0) {
      const scoped = request.backend.parseLeading({ kind: "group", route: Object.freeze([...route]) }, operands);
      if (scoped.status === "failure") return { kind: "grammar", failure: scoped.failure };
      operands = scoped.operands;
    }
    const segment = operands[0];
    if (segment === undefined) {
      return { kind: "usage", usageFailure: { code: "no-command", route: Object.freeze([...route]) } };
    }
    const depth = route.length;
    route.push(segment);
    operands = operands.slice(1);
    const matches = candidates.filter((child) => child.route[depth] === segment);
    if (matches.length === 0) {
      return { kind: "usage", usageFailure: { code: "unknown-command", route: Object.freeze(route) } };
    }
    const exact = matches.find((child) => child.route.length === route.length);
    if (exact?.kind === "command") {
      return { kind: "command", node: exact as Node, route: Object.freeze(route), tail: operands, root };
    }
    candidates = exact?.kind === "group" ? exact.children : matches;
  }
}

/**
 * Executes one argv invocation through the canonical runtime path.
 *
 * Standard shell controls, help intent, route/command resolution, and
 * unknown/no-command classification are owned here; the backend only parses argv
 * grammar. A resolved command is executed without re-resolving its route.
 */
export async function executeCanonicalArgv<const Catalog extends CommandCatalog, Failure, RootState = unknown>(
  product: CanonicalRuntimeProduct<Catalog>,
  request: CanonicalArgvRequest<Failure, RootState>,
): Promise<CanonicalArgvOutcome<Catalog, Failure>> {
  const resolution = resolveArgvRequest<CommandTreeCommandNode, Failure, RootState>(
    (product.tree as unknown as CommandTreeRootNode).children,
    request,
    product.packageMetadata,
  );
  if (resolution.kind !== "command") return resolution.outcome;
  return executeResolvedArgv(product, resolution.node, resolution, request);
}

type ArgvCommandResolution<Node, Failure, RootState> = Extract<
  ArgvRouteResolution<Node, Failure, RootState>,
  { readonly kind: "command" }
> & { readonly presentation: PresentationMode };

type ArgvRequestResolution<Node, Failure, RootState> =
  | ArgvCommandResolution<Node, Failure, RootState>
  | {
      readonly kind: "outcome";
      readonly outcome: (
        | { readonly status: "help"; readonly help: ParsedHelpMode }
        | { readonly status: "version"; readonly packageMetadata: ProductPackageIdentity }
        | { readonly status: "failure"; readonly failureKind: "usage"; readonly usageFailure: CanonicalUsageFailure }
        | { readonly status: "failure"; readonly failureKind: "grammar"; readonly grammarFailure: Failure }
        | { readonly status: "failure"; readonly failureKind: "unexpected"; readonly error: unknown }
      ) & { readonly presentation: PresentationMode };
    };

function withPresentation<Outcome extends object>(
  outcome: Outcome,
  presentation: PresentationMode,
): Outcome & { readonly presentation: PresentationMode } {
  const next = { ...outcome, presentation };
  return Object.isFrozen(outcome) ? Object.freeze(next) : next;
}

/**
 * Resolves the standard shell once, then the command route; nothing is parsed for a
 * command or executed here.
 *
 * Shell order: one route-scoped scan classifies Help and `--json` tokens; every scanned
 * `--json` selects `machine` presentation and is removed from the argv seen by the
 * grammar backend and delegated executors; Help wins over version and route resolution;
 * the remaining argv exactly `["--version"]` is a version request when package metadata
 * is present; otherwise the remaining argv resolves as a route, so empty argv is `no-command`.
 */
function resolveArgvRequest<Node extends ArgvTreeNode & { readonly kind: "command" }, Failure, RootState>(
  children: readonly ArgvTreeNode[],
  request: CanonicalArgvRequest<Failure, RootState>,
  packageMetadata: ProductPackageIdentity | undefined,
): ArgvRequestResolution<Node, Failure, RootState> {
  let presentation: PresentationMode = "human";
  let resolution: ArgvRouteResolution<Node, Failure, RootState>;
  try {
    const shell = scanShellArgv(request.help, request.argv);
    if (shell.json) presentation = "machine";
    const help = parsedHelpFromScan(shell, presentation === "machine" ? "json" : request.helpFormat);
    if (help !== undefined) {
      if (help.invalidMode === undefined) return { kind: "outcome", outcome: { status: "help", help, presentation } };
      return {
        kind: "outcome",
        outcome: {
          status: "failure",
          failureKind: "usage",
          usageFailure: { code: "invalid-help-mode", route: Object.freeze([]), value: help.invalidMode },
          presentation,
        },
      };
    }
    if (packageMetadata !== undefined && shell.argv.length === 1 && shell.argv[0] === "--version") {
      return { kind: "outcome", outcome: { status: "version", packageMetadata, presentation } };
    }
    resolution = resolveArgvRoute<Node, Failure, RootState>(children, { ...request, argv: shell.argv });
  } catch (error) {
    return { kind: "outcome", outcome: { status: "failure", failureKind: "unexpected", error, presentation } };
  }
  if (resolution.kind === "grammar") {
    return {
      kind: "outcome",
      outcome: { status: "failure", failureKind: "grammar", grammarFailure: resolution.failure, presentation },
    };
  }
  if (resolution.kind === "usage") {
    return {
      kind: "outcome",
      outcome: { status: "failure", failureKind: "usage", usageFailure: resolution.usageFailure, presentation },
    };
  }
  return { ...resolution, presentation };
}

/** Parses the argv following a resolved canonical command and executes it without re-resolving its route. */
async function executeResolvedArgv<const Catalog extends CommandCatalog, Failure, RootState>(
  product: CanonicalRuntimeProduct<Catalog>,
  node: CommandTreeCommandNode,
  resolution: {
    readonly route: readonly string[];
    readonly tail: readonly string[];
    readonly root: RootState;
    readonly presentation: PresentationMode;
  },
  request: CanonicalArgvRequest<Failure, RootState>,
): Promise<CanonicalArgvOutcome<Catalog, Failure>> {
  const { presentation } = resolution;
  let parsed: ReturnType<CanonicalArgvRequest<Failure, RootState>["backend"]["parseCommand"]>;
  try {
    parsed = request.backend.parseCommand(node, resolution.tail, resolution.root);
  } catch (error) {
    return {
      status: "failure",
      failureKind: "unexpected",
      commandId: node.id as CommandId<Catalog>,
      error,
      presentation,
    };
  }
  if (parsed.status === "failure") {
    return { status: "failure", failureKind: "grammar", grammarFailure: parsed.failure, presentation };
  }
  const outcome = await executeCommandNode(product, node, resolution.route, parsed.input);
  return withPresentation(outcome, presentation) as CanonicalArgvOutcome<Catalog, Failure>;
}

function findCanonicalCommand(
  children: readonly CommandTreeChildNode[],
  id: string,
): CommandTreeCommandNode | undefined {
  for (const child of children) {
    if (child.kind === "command") {
      if (child.id === id) return child;
      continue;
    }
    const found = findCanonicalCommand(child.children, id);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Executes one argv invocation against a composed command tree.
 *
 * Standard shell controls, help intent, and the command route are resolved structurally
 * against the composed tree before any executor runs; help and version never invoke a
 * delegated executor. The resolved
 * node's owner selects exactly one executor: canonical owners execute through the
 * semantic runtime and delegated owners cross their one explicit executor boundary.
 * `unknown-command` means no source owns the route. No outcome of the selected owner,
 * including usage, validation, handler, or delegated failures, dispatches to another source.
 */
export async function executeComposedArgv<
  Failure,
  RootState = unknown,
  Result = unknown,
  SourceId extends string = string,
>(
  product: ComposedRuntimeProduct<SourceId, Result>,
  request: CanonicalArgvRequest<Failure, RootState>,
): Promise<ComposedArgvOutcome<Failure, Result, SourceId>> {
  const canonicalSources = product.sources.filter(
    (source): source is Extract<(typeof product.sources)[number], { readonly kind: "canonical" }> =>
      source.kind === "canonical",
  );
  const packageMetadata =
    canonicalSources.length === 1 ? canonicalSources[0]?.product.packageMetadata : undefined;
  const resolution = resolveArgvRequest<ComposedCommandNode<SourceId>, Failure, RootState>(
    product.tree.root.children,
    request,
    packageMetadata,
  );
  if (resolution.kind !== "command") return resolution.outcome;

  const { node, presentation } = resolution;
  const { kind, sourceId } = node.owner;
  const source = product.sources.find((candidate) => candidate.id === sourceId && candidate.kind === kind);
  if (source?.kind === "delegated") {
    if (typeof source.execute !== "function") {
      return {
        status: "failure",
        failureKind: "unexpected",
        error: new CanonicalRequestError(`${node.id}: delegated source ${sourceId} declares no executor`),
        presentation,
      };
    }
    let result: Result;
    try {
      result = await source.execute(
        Object.freeze({
          sourceId,
          commandId: node.id,
          route: node.route,
          argv: Object.freeze([...resolution.tail]),
          presentation,
        }),
      );
    } catch (error) {
      return { status: "failure", failureKind: "delegated-error", sourceId, commandId: node.id, error, presentation };
    }
    return Object.freeze({
      status: "delegated",
      sourceId,
      commandId: node.id,
      route: node.route,
      result,
      presentation,
    });
  }

  const canonical =
    source?.kind === "canonical"
      ? findCanonicalCommand((source.product.tree as unknown as CommandTreeRootNode).children, node.id)
      : undefined;
  if (source === undefined || canonical === undefined) {
    return {
      status: "failure",
      failureKind: "unexpected",
      error: new CanonicalRequestError(`${node.id}: composed owner ${sourceId} has no matching ${kind} source`),
      presentation,
    };
  }
  return executeResolvedArgv(source.product as CanonicalRuntimeProduct, canonical, resolution, request);
}
