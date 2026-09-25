import type { CompiledField } from "../command/compiler.js";
import { projectCommandDiscovery, type ProductDiscovery } from "./discovery.js";
import { renderHelpDocument } from "../presentation/help.js";
import {
  helpTargetScopes,
  projectHelpDocument,
  resolveHelpTarget,
  type HelpModelProduct,
  type HelpTarget,
  type HelpTargetScope,
} from "./help-model.js";

export {
  projectHelpDocument,
  resolveHelpTarget,
  type HelpChildEntry,
  type HelpDocument,
  type HelpDocumentMode,
  type HelpFieldEntry,
  type HelpModelProduct,
  type HelpTarget,
  type HelpTreeChild,
  type HelpTreeSource,
} from "./help-model.js";

export type HelpMode = "text" | "full";
export type HelpOutputMode = "summary" | "full" | "json";

export type HelpRequest =
  | { readonly kind: "root"; readonly mode?: HelpMode }
  | { readonly kind: "route"; readonly route: readonly string[]; readonly mode?: HelpMode }
  | { readonly kind: "command"; readonly commandId: string; readonly mode?: HelpMode };

export interface HelpProjectionProduct extends HelpModelProduct {}

export interface ParsedHelpMode {
  readonly mode: HelpOutputMode;
  readonly request: HelpRequest;
  readonly invalidMode?: string;
}

/** Option grammar by spelling; `null` marks a spelling whose declarations disagree on arity. */
type OptionTable = ReadonlyMap<string, CompiledField | null>;

function sameArity(left: CompiledField, right: CompiledField): boolean {
  return left.kind === right.kind && (left.kind !== "option" || left.valueArity === right.valueArity);
}

function optionTable(fields: Iterable<CompiledField>): OptionTable {
  const table = new Map<string, CompiledField | null>();
  for (const field of fields) {
    if ((field.kind !== "option" && field.kind !== "flag") || field.flag === undefined) continue;
    for (const spelling of [field.flag, ...(field.aliases ?? [])]) {
      const existing = table.get(spelling);
      table.set(spelling, existing === undefined || (existing !== null && sameArity(existing, field)) ? field : null);
    }
  }
  return table;
}

/** Group and command help targets, longest route first, then in route order. */
function sortedHelpScopes(product: HelpProjectionProduct): readonly HelpTargetScope[] {
  return [...helpTargetScopes(product)].sort((left, right) => {
    const leftRoute = left.target.route.join(" ");
    const rightRoute = right.target.route.join(" ");
    return (
      right.target.route.length - left.target.route.length ||
      (leftRoute < rightRoute ? -1 : leftRoute > rightRoute ? 1 : 0)
    );
  });
}

/** The longest group or command route at the earliest route word; undefined is the root. */
function resolveHelpScope(scopes: readonly HelpTargetScope[], words: readonly string[]): HelpTargetScope | undefined {
  for (let start = 0; start < words.length; start += 1) {
    for (const scope of scopes) {
      if (scope.target.route.every((segment, offset) => words[start + offset] === segment)) return scope;
    }
  }
  return undefined;
}

function helpRequest(scope: HelpTargetScope | undefined, mode: HelpMode): HelpRequest {
  if (scope === undefined) return { kind: "root", mode };
  return scope.target.kind === "command"
    ? { kind: "command", commandId: scope.target.id, mode }
    : { kind: "route", route: scope.target.route, mode };
}

/**
 * Parses --help modes and resolves their target from the resolved command tree.
 *
 * Option values are classified by the grammar of the route scope reached so far: before
 * a command route resolves, only `anywhere` options apply; after it, only the resolved
 * command's declared fields. Declarations of other commands never change a route's help
 * intent. Tokens after the first `--` are never help tokens.
 */
export function parseHelpMode(
  product: HelpProjectionProduct,
  argv: readonly string[],
  defaultMode?: HelpOutputMode | "text",
): ParsedHelpMode | undefined {
  const delimiter = argv.indexOf("--");
  const end = delimiter === -1 ? argv.length : delimiter;
  const scopes = sortedHelpScopes(product);
  const preRouteOptions = optionTable(
    product.commands.flatMap((command) => command.fields.filter((field) => field.placement === "anywhere")),
  );
  let options = preRouteOptions;
  let scope: HelpTargetScope | undefined;
  const routeWords: string[] = [];
  let detected: { readonly mode: HelpOutputMode; readonly invalidMode?: string } | undefined;

  for (let index = 0; index < end; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;
    if (token === "--help" || token === "-h" || token.startsWith("--help=")) {
      const value = token.startsWith("--help=") ? token.slice("--help=".length) : undefined;
      const validValue =
        value === undefined || value === "summary" || value === "text" || value === "full" || value === "json";
      detected ??= {
        mode: value === "full" || value === "json" ? value : "summary",
        ...(validValue ? {} : { invalidMode: value }),
      };
      continue;
    }
    if (token === "--") break;

    const flag = token.startsWith("-") ? token.split("=", 1)[0] : undefined;
    const declaration = flag === undefined ? undefined : options.get(flag);
    const hasInlineValue = token.includes("=");
    if (declaration?.kind === "option" && !hasInlineValue) {
      const next = argv[index + 1];
      if (
        declaration.valueArity !== "optional" ||
        (next !== undefined && (!next.startsWith("-") || /^-\d/u.test(next)))
      ) {
        index += 1;
        continue;
      }
    }
    if (token.startsWith("-")) continue;
    routeWords.push(token);
    const next = resolveHelpScope(scopes, routeWords);
    if (next !== scope) {
      scope = next;
      options = scope?.target.kind === "command" ? optionTable(scope.fields) : preRouteOptions;
    }
  }

  if (detected === undefined) return undefined;
  const mode =
    detected.invalidMode === undefined
      ? defaultMode === undefined
        ? detected.mode
        : defaultMode === "text"
          ? "summary"
          : defaultMode
      : detected.mode;
  const request = helpRequest(scope, mode === "full" ? "full" : "text");
  return {
    mode,
    request,
    ...(detected.invalidMode === undefined ? {} : { invalidMode: detected.invalidMode }),
  };
}

function requestTarget(product: HelpProjectionProduct, request: HelpRequest): HelpTarget | undefined {
  if (request.kind === "root") return { kind: "root" };
  if (request.kind === "route") return resolveHelpTarget(product, request.route);
  const command = product.commands.find((candidate) => candidate.id === request.commandId);
  return command === undefined ? undefined : { kind: "command", id: command.id, route: command.route };
}

/** Projects a parsed help request to summary/full text or machine-readable discovery of the same help document. */
export function projectHelp(product: HelpProjectionProduct, parsed: ParsedHelpMode): string | ProductDiscovery {
  if (parsed.mode !== "json")
    return renderHelp(product, { ...parsed.request, mode: parsed.mode === "full" ? "full" : "text" });

  const target = requestTarget(product, parsed.request);
  const document = target === undefined ? undefined : projectHelpDocument(product, target);
  return projectCommandDiscovery(product, document?.commands ?? product.commands);
}

export { renderHelpDocument } from "../presentation/help.js";

export function renderHelp(product: HelpProjectionProduct, request: HelpRequest = { kind: "root" }): string {
  const target = requestTarget(product, request);
  const document =
    target === undefined
      ? undefined
      : projectHelpDocument(product, target, request.mode === "full" ? "full" : "summary");
  if (document !== undefined) return renderHelpDocument(document);
  return request.kind === "command"
    ? `Unknown command id: ${request.commandId}\n`
    : `Unknown command route: ${request.kind === "route" ? request.route.join(" ") : ""}\n`;
}
