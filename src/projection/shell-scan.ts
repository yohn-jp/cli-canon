import type { CompiledField } from "../command/compiler.js";
import type { HelpMode, HelpOutputMode, HelpRequest, ParsedHelpMode } from "./help.js";
import { helpTargetScopes, type HelpModelProduct, type HelpTargetScope } from "./help-model.js";

/** The first scanned Help token. */
export interface ShellHelpToken {
  readonly mode: HelpOutputMode;
  readonly invalidMode?: string;
}

/**
 * One classification of invocation argv into Canon shell tokens.
 *
 * `argv` is the input argv with every scanned `--json` selector removed; all other
 * tokens, including Help tokens and every token after `--`, are kept verbatim.
 */
export interface ShellScan {
  readonly argv: readonly string[];
  readonly json: boolean;
  readonly help?: ShellHelpToken;
  /** The deepest group or command help scope reached by route words; undefined is the root. */
  readonly scope?: HelpTargetScope;
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
function sortedHelpScopes(product: HelpModelProduct): readonly HelpTargetScope[] {
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

/**
 * Classifies Help and `--json` shell tokens with one route-scoped scan.
 *
 * Option values are classified by the grammar of the route scope reached so far: before
 * a command route resolves, only `anywhere` options apply; after it, only the resolved
 * command's declared fields. A token consumed as a declared option value is never a
 * shell token, and tokens after the first `--` are never shell tokens.
 */
export function scanShellArgv(product: HelpModelProduct, argv: readonly string[]): ShellScan {
  const delimiter = argv.indexOf("--");
  const end = delimiter === -1 ? argv.length : delimiter;
  const scopes = sortedHelpScopes(product);
  const preRouteOptions = optionTable(
    product.commands.flatMap((command) => command.fields.filter((field) => field.placement === "anywhere")),
  );
  let options = preRouteOptions;
  let scope: HelpTargetScope | undefined;
  const routeWords: string[] = [];
  const selectors = new Set<number>();
  let help: ShellHelpToken | undefined;

  for (let index = 0; index < end; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;
    if (token === "--json") {
      selectors.add(index);
      continue;
    }
    if (token === "--help" || token === "-h" || token.startsWith("--help=")) {
      const value = token.startsWith("--help=") ? token.slice("--help=".length) : undefined;
      const validValue =
        value === undefined || value === "summary" || value === "text" || value === "full" || value === "json";
      help ??= {
        mode: value === "full" || value === "json" ? value : "summary",
        ...(validValue ? {} : { invalidMode: value }),
      };
      continue;
    }

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

  return {
    argv: selectors.size === 0 ? argv : argv.filter((_token, index) => !selectors.has(index)),
    json: selectors.size > 0,
    ...(help === undefined ? {} : { help }),
    ...(scope === undefined ? {} : { scope }),
  };
}

function helpRequest(scope: HelpTargetScope | undefined, mode: HelpMode): HelpRequest {
  if (scope === undefined) return { kind: "root", mode };
  return scope.target.kind === "command"
    ? { kind: "command", commandId: scope.target.id, mode }
    : { kind: "route", route: scope.target.route, mode };
}

/** Resolves the Help request of an already scanned invocation; undefined when no Help token was scanned. */
export function parsedHelpFromScan(scan: ShellScan, defaultMode?: HelpOutputMode | "text"): ParsedHelpMode | undefined {
  const detected = scan.help;
  if (detected === undefined) return undefined;
  const mode =
    detected.invalidMode === undefined
      ? defaultMode === undefined
        ? detected.mode
        : defaultMode === "text"
          ? "summary"
          : defaultMode
      : detected.mode;
  const request = helpRequest(scan.scope, mode === "full" ? "full" : "text");
  return {
    mode,
    request,
    ...(detected.invalidMode === undefined ? {} : { invalidMode: detected.invalidMode }),
  };
}
