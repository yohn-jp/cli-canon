import { projectCommandDiscovery, type ProductDiscovery } from "./discovery.js";
import { renderHelpDocument } from "../presentation/help.js";
import { parsedHelpFromScan, scanShellArgv } from "./shell-scan.js";
import { projectHelpDocument, resolveHelpTarget, type HelpModelProduct, type HelpTarget } from "./help-model.js";

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
  return parsedHelpFromScan(scanShellArgv(product, argv), defaultMode);
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
