import type { CompiledField } from "../command/compiler.js";
import type { ProjectionCommandSource, ProjectionProductSource } from "./source.js";
import { projectDiscovery, type ProductDiscovery } from "./discovery.js";

export type HelpMode = "text" | "full";
export type HelpOutputMode = "summary" | "full" | "json";

export type HelpRequest =
  | { readonly kind: "root"; readonly mode?: HelpMode }
  | { readonly kind: "route"; readonly route: readonly string[]; readonly mode?: HelpMode }
  | { readonly kind: "command"; readonly commandId: string; readonly mode?: HelpMode };

export interface HelpProjectionProduct extends ProjectionProductSource {}

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

function helpRouteCandidates(product: HelpProjectionProduct): readonly (readonly string[])[] {
  const candidates = new Map<string, readonly string[]>();
  for (const command of product.commands) {
    for (let length = 1; length <= command.route.length; length += 1) {
      const route = command.route.slice(0, length);
      candidates.set(route.join("\u0000"), route);
    }
  }
  return [...candidates.values()].sort(
    (left, right) =>
      right.length - left.length || (left.join(" ") < right.join(" ") ? -1 : left.join(" ") > right.join(" ") ? 1 : 0),
  );
}

function resolveHelpRequest(product: HelpProjectionProduct, words: readonly string[], mode: HelpMode): HelpRequest {
  const routes = helpRouteCandidates(product);
  for (let start = 0; start < words.length; start += 1) {
    for (const route of routes) {
      if (route.every((segment, offset) => words[start + offset] === segment)) {
        const command = product.commands.find(
          (candidate) =>
            candidate.route.length === route.length &&
            candidate.route.every((segment, index) => route[index] === segment),
        );
        return command === undefined
          ? { kind: "route", route, mode }
          : { kind: "command", commandId: command.id, mode };
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

/** Projects a parsed help request to summary/full text or machine-readable discovery. */
export function projectHelp(product: HelpProjectionProduct, parsed: ParsedHelpMode): string | ProductDiscovery {
  if (parsed.mode !== "json")
    return renderHelp(product, { ...parsed.request, mode: parsed.mode === "full" ? "full" : "text" });

  const request = parsed.request;
  let route: readonly string[] | undefined;
  if (request.kind === "route") route = request.route;
  else if (request.kind === "command") {
    route = product.commands.find((command) => command.id === request.commandId)?.route;
  }
  return projectDiscovery(product, route === undefined ? {} : { route });
}

function fieldSyntax(field: CompiledField): string {
  if (field.kind === "flag") return `[${[...(field.aliases ?? []), field.flag].join(", ")}]`;
  if (field.kind === "option") {
    const names = [...(field.aliases ?? []), field.flag].join(", ");
    const value = `<${field.metavar ?? field.key}>${field.repeatable === true ? "..." : ""}`;
    const valueSyntax = field.valueArity === "optional" ? `[=${value}]` : ` ${value}`;
    const syntax = `${names}${valueSyntax}`;
    return field.required === true ? syntax : `[${syntax}]`;
  }
  if (field.kind === "positional") {
    const value = `<${field.metavar ?? field.key}>`;
    return field.required === false ? `[${value}]` : value;
  }
  return "[-- <args...>]";
}

function commandUsage(productName: string, command: ProjectionCommandSource): string {
  return [productName, ...command.route, ...command.fields.map(fieldSyntax)].join(" ");
}

function helpFooter(): string {
  return "Help: --help[=full|json]";
}

function sortedCommands(product: HelpProjectionProduct): readonly ProjectionCommandSource[] {
  return [...product.commands].sort((left, right) => {
    const leftRoute = left.route.join(" ");
    const rightRoute = right.route.join(" ");
    return leftRoute < rightRoute
      ? -1
      : leftRoute > rightRoute
        ? 1
        : left.id < right.id
          ? -1
          : left.id > right.id
            ? 1
            : 0;
  });
}

function renderFields(command: ProjectionCommandSource): string[] {
  const positionals = command.fields.filter((field) => field.kind === "positional" || field.kind === "raw-args");
  const options = command.fields.filter((field) => field.kind === "option" || field.kind === "flag");
  const lines: string[] = [];
  if (positionals.length > 0) {
    lines.push("Arguments:");
    for (const field of positionals) {
      const name = field.kind === "raw-args" ? "[-- <args...>]" : fieldSyntax(field);
      lines.push(`  ${name}${field.description === undefined ? "" : `\t${field.description}`}`);
    }
  }
  if (options.length > 0) {
    lines.push("Options:");
    for (const field of options) {
      const name = field.kind === "flag" ? [...(field.aliases ?? []), field.flag].join(", ") : fieldSyntax(field);
      lines.push(`  ${name}${field.description === undefined ? "" : `\t${field.description}`}`);
    }
  }
  return lines;
}

function renderCommandHelp(command: ProjectionCommandSource, productName: string, mode: HelpMode): string {
  const lines = [`Usage: ${commandUsage(productName, command)}`, "", command.summary];
  if (mode === "full") {
    if (command.description !== undefined) lines.push("", command.description);
    const fields = renderFields(command);
    if (fields.length > 0) lines.push("", ...fields);
    if (command.examples !== undefined && command.examples.length > 0) {
      lines.push("", "Examples:", ...command.examples.map((example) => `  ${example}`));
    }
  }
  lines.push("", helpFooter(), "");
  return lines.join("\n");
}

function routeChildren(
  product: HelpProjectionProduct,
  route: readonly string[],
): readonly { readonly segment: string; readonly command: ProjectionCommandSource }[] {
  const children = new Map<string, ProjectionCommandSource>();
  for (const command of sortedCommands(product)) {
    if (route.length >= command.route.length || !route.every((segment, index) => command.route[index] === segment))
      continue;
    const segment = command.route[route.length];
    if (segment !== undefined && !children.has(segment)) children.set(segment, command);
  }
  return [...children.entries()].map(([segment, command]) => ({ segment, command }));
}

function renderRouteHelp(product: HelpProjectionProduct, route: readonly string[], mode: HelpMode): string {
  const exact = product.commands.find(
    (command) =>
      command.route.length === route.length && command.route.every((segment, index) => route[index] === segment),
  );
  if (exact !== undefined) return renderCommandHelp(exact, product.name, mode);

  const children = routeChildren(product, route);
  if (children.length === 0) return `Unknown command route: ${route.join(" ")}\n`;
  const lines = [`Usage: ${[product.name, ...route, "<command>"].join(" ")}`, "", "Commands:"];
  for (const { segment, command } of children) {
    lines.push(`  ${segment}\t${command.summary}`);
    if (mode === "full" && command.description !== undefined) lines.push(`    ${command.description}`);
  }
  lines.push("", helpFooter(), "");
  return lines.join("\n");
}

function renderRootHelp(product: HelpProjectionProduct, mode: HelpMode): string {
  const lines = [`Usage: ${product.name} <command>`, "", "Commands:"];
  for (const { segment, command } of routeChildren(product, [])) {
    lines.push(`  ${segment}\t${command.summary}`);
    if (mode === "full" && command.description !== undefined) lines.push(`    ${command.description}`);
  }
  lines.push("", helpFooter(), "");
  return lines.join("\n");
}

export function renderHelp(product: HelpProjectionProduct, request: HelpRequest = { kind: "root" }): string {
  const mode = request.mode ?? "text";
  if (request.kind === "command") {
    const command = product.commands.find((candidate) => candidate.id === request.commandId);
    if (command === undefined) return `Unknown command id: ${request.commandId}\n`;
    return renderCommandHelp(command, product.name, mode);
  }
  if (request.kind === "route") {
    return request.route.length === 0 ? renderRootHelp(product, mode) : renderRouteHelp(product, request.route, mode);
  }
  return renderRootHelp(product, mode);
}
