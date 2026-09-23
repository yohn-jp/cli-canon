import type { CompiledCommand, CompiledField, CompiledProduct } from "../command/compiler.js";
import type { CommandCatalog } from "../command/model.js";

export type HelpMode = "text" | "full";

export type HelpRequest =
  | { readonly kind: "root"; readonly mode?: HelpMode }
  | { readonly kind: "route"; readonly route: readonly string[]; readonly mode?: HelpMode }
  | { readonly kind: "command"; readonly commandId: string; readonly mode?: HelpMode };

export interface HelpProjectionProduct<Catalog extends CommandCatalog = CommandCatalog> {
  readonly name: string;
  readonly commands: CompiledProduct<Catalog>["commands"];
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

function commandUsage(productName: string, command: CompiledCommand): string {
  return [productName, ...command.route, ...command.fields.map(fieldSyntax)].join(" ");
}

function helpFooter(): string {
  return "Help: --help[=full|json]";
}

function sortedCommands<const Catalog extends CommandCatalog>(
  product: HelpProjectionProduct<Catalog>,
): readonly CompiledCommand[] {
  return [...product.commands].sort((left, right) => {
    const leftRoute = left.route.join(" ");
    const rightRoute = right.route.join(" ");
    return leftRoute < rightRoute ? -1 : leftRoute > rightRoute ? 1 : left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

function renderFields(command: CompiledCommand): string[] {
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

function renderCommandHelp(command: CompiledCommand, productName: string, mode: HelpMode): string {
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

function routeChildren<const Catalog extends CommandCatalog>(
  product: HelpProjectionProduct<Catalog>,
  route: readonly string[],
): readonly { readonly segment: string; readonly command: CompiledCommand }[] {
  const children = new Map<string, CompiledCommand>();
  for (const command of sortedCommands(product)) {
    if (route.length >= command.route.length || !route.every((segment, index) => command.route[index] === segment)) continue;
    const segment = command.route[route.length];
    if (segment !== undefined && !children.has(segment)) children.set(segment, command);
  }
  return [...children.entries()].map(([segment, command]) => ({ segment, command }));
}

function renderRouteHelp<const Catalog extends CommandCatalog>(
  product: HelpProjectionProduct<Catalog>,
  route: readonly string[],
  mode: HelpMode,
): string {
  const exact = product.commands.find((command) => command.route.length === route.length && command.route.every((segment, index) => route[index] === segment));
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

function renderRootHelp<const Catalog extends CommandCatalog>(
  product: HelpProjectionProduct<Catalog>,
  mode: HelpMode,
): string {
  const lines = [`Usage: ${product.name} <command>`, "", "Commands:"];
  for (const { segment, command } of routeChildren(product, [])) {
    lines.push(`  ${segment}\t${command.summary}`);
    if (mode === "full" && command.description !== undefined) lines.push(`    ${command.description}`);
  }
  lines.push("", helpFooter(), "");
  return lines.join("\n");
}

export function renderHelp<const Catalog extends CommandCatalog>(
  product: HelpProjectionProduct<Catalog>,
  request: HelpRequest = { kind: "root" },
): string {
  const mode = request.mode ?? "text";
  if (request.kind === "command") {
    const command = product.commands.find((candidate) => candidate.id === request.commandId);
    if (command === undefined) return `Unknown command id: ${request.commandId}\n`;
    return renderCommandHelp(command, product.name, mode);
  }
  if (request.kind === "route") {
    return request.route.length === 0
      ? renderRootHelp(product, mode)
      : renderRouteHelp(product, request.route, mode);
  }
  return renderRootHelp(product, mode);
}
