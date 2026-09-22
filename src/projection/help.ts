import type { CommandCatalog } from "../command/model.js";
import type { CompiledProduct } from "../command/compiler.js";

export type HelpRequest =
  | { readonly kind: "root" }
  | { readonly kind: "command"; readonly commandId: string };

/**
 * Deterministic human-readable help projected from the same CompiledProduct
 * used for routing. It does not read process.argv or write to stdout.
 */
export declare function renderHelp<const Catalog extends CommandCatalog>(
  product: CompiledProduct<Catalog>,
  request?: HelpRequest,
): string;
