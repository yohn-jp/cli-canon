import type { CompiledCommand, CompiledProduct } from "../command/compiler.js";
import type { CommandCatalog } from "../command/model.js";

export type HelpRequest =
  | { readonly kind: "root" }
  | { readonly kind: "command"; readonly commandId: string };

function optionSyntax(field: CompiledCommand["fields"][number]): string {
  if (field.kind === "flag") return `[${[...(field.aliases ?? []), field.flag].join(", ")}]`;
  if (field.kind === "option") {
    const value = `<${field.metavar ?? field.key}>${field.repeatable === true ? "..." : ""}`;
    const syntax = `${[...(field.aliases ?? []), field.flag].join(", ")} ${value}`;
    return field.required === true ? syntax : `[${syntax}]`;
  }
  if (field.kind === "positional") return `<${field.metavar ?? field.key}>`;
  return "[-- <args...>]";
}

function commandUsage(productName: string, command: CompiledCommand): string {
  return [productName, ...command.route, ...command.fields.map(optionSyntax)].join(" ");
}

export function renderHelp<const Catalog extends CommandCatalog>(
  product: CompiledProduct<Catalog>,
  request: HelpRequest = { kind: "root" },
): string {
  if (request.kind === "command") {
    const command = product.commands.find((candidate) => candidate.id === request.commandId);
    if (command === undefined) return `Unknown command id: ${request.commandId}\n`;
    return [`Usage: ${commandUsage(product.name, command)}`, "", command.summary, ""].join("\n");
  }
  const lines = [`Usage: ${product.name} <command>`, "", "Commands:"];
  for (const command of product.commands) lines.push(`  ${command.route.join(" ")}\t${command.summary}`);
  return `${lines.join("\n")}\n`;
}
