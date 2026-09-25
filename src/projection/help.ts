import type { CompiledField } from "../command/compiler.js";
import { projectCommandDiscovery, type ProductDiscovery } from "./discovery.js";
import { renderHelpDocument } from "../presentation/help.js";
import {
  helpTargetRoutes,
  projectHelpDocument,
  resolveHelpTarget,
  type HelpModelProduct,
  type HelpTarget,
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

function declaredOptions(product: HelpProjectionProduct): ReadonlyMap<string, CompiledField> {
  const options = new Map<string, CompiledField>();
  for (const command of product.commands) {
    for (const field of command.fields) {
      if ((field.kind === "option" || field.kind === "flag") && field.flag !== undefined) {
        options.set(field.flag, field);
        for (const alias of field.aliases ?? []) options.set(alias, field);
      }
    }
  }
  return options;
}

function resolveHelpRequest(product: HelpProjectionProduct, words: readonly string[], mode: HelpMode): HelpRequest {
  const routes = [...helpTargetRoutes(product)].sort(
    (left, right) =>
      right.length - left.length || (left.join(" ") < right.join(" ") ? -1 : left.join(" ") > right.join(" ") ? 1 : 0),
  );
  for (let start = 0; start < words.length; start += 1) {
    for (const route of routes) {
      if (route.every((segment, offset) => words[start + offset] === segment)) {
        const target = resolveHelpTarget(product, route);
        return target?.kind === "command"
          ? { kind: "command", commandId: target.id, mode }
          : { kind: "route", route, mode };
      }
    }
  }
  return { kind: "root", mode };
}

/** Parses --help modes and resolves their route from canonical and legacy descriptors. */
export function parseHelpMode(
  product: HelpProjectionProduct,
  argv: readonly string[],
  defaultMode?: HelpOutputMode | "text",
): ParsedHelpMode | undefined {
  const delimiter = argv.indexOf("--");
  const end = delimiter === -1 ? argv.length : delimiter;
  const options = declaredOptions(product);
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
  const request = resolveHelpRequest(product, routeWords, mode === "full" ? "full" : "text");
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
