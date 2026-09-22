import type { CommandCatalog } from "../command/model.js";
import type { CompiledProduct } from "../command/compiler.js";

/** JSON-safe projection. Schemas, handlers, closures, and secrets are omitted. */
export interface CommandDiscovery {
  readonly id: string;
  readonly route: readonly string[];
  readonly summary: string;
  readonly fields: readonly {
    readonly key: string;
    readonly kind: "positional" | "option" | "flag" | "raw-args";
    readonly flag?: string;
    readonly aliases?: readonly string[];
    readonly repeatable?: boolean;
    readonly placement?: "after-route" | "anywhere";
    readonly metavar?: string;
  }[];
}

export interface ProductDiscovery {
  readonly name: string;
  readonly commands: readonly CommandDiscovery[];
}

export declare function projectDiscovery<const Catalog extends CommandCatalog>(
  product: CompiledProduct<Catalog>,
): ProductDiscovery;
