import type { HelpDocument } from "../projection/help-model.js";
import { renderUsage } from "./usage.js";

function entryLine(label: string, description: string | undefined): string {
  return `  ${label}${description === undefined ? "" : `\t${description}`}`;
}

/** Renders the canonical help document as deterministic plain text. */
export function renderHelpDocument(document: HelpDocument): string {
  const lines = [renderUsage(document.usage)];
  if (document.summary !== undefined) lines.push("", document.summary);
  if (document.description !== undefined) lines.push("", document.description);
  const fields: string[] = [];
  if (document.arguments.length > 0) {
    fields.push("Arguments:", ...document.arguments.map((entry) => entryLine(entry.label, entry.description)));
  }
  if (document.options.length > 0) {
    fields.push("Options:", ...document.options.map((entry) => entryLine(entry.label, entry.description)));
  }
  if (fields.length > 0) lines.push("", ...fields);
  if (document.children.length > 0) {
    lines.push("", "Commands:");
    for (const child of document.children) {
      lines.push(entryLine(child.name, child.summary));
      if (child.description !== undefined) lines.push(`    ${child.description}`);
    }
  }
  if (document.examples.length > 0) {
    lines.push("", "Examples:", ...document.examples.map((example) => `  ${example}`));
  }
  lines.push("", "Help: --help[=full|json]", "");
  return lines.join("\n");
}
