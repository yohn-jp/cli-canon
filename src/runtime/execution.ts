import type { CommandCatalog, CommandDefinition, CommandId, FieldDefinition } from "../command/model.js";
import type { CommandTreeChildNode, CommandTreeCommandNode, CommandTreeRootNode } from "../command/tree.js";
import {
  CanonicalRequestError,
  type CanonicalCommandRequest,
  type CanonicalExecutionOutcome,
  type CanonicalRuntimeProduct,
  type CanonicalUsageFailure,
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

  const node = resolution.node;
  const commandId = node.id as CommandId<Catalog>;
  const input = request.input ?? {};
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
