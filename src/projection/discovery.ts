import type { CommandCatalog } from "../command/model.js";
import type { CompiledProduct } from "../command/compiler.js";
import type { OptionLookingValuePolicy, OptionValueArity } from "../command/model.js";

export interface CommandDiscovery {
  readonly id: string;
  readonly route: readonly string[];
  readonly summary: string;
  readonly description?: string;
  readonly examples?: readonly string[];
  readonly fields: readonly {
    readonly key: string;
    readonly kind: "positional" | "option" | "flag" | "raw-args";
    readonly flag?: string;
    readonly aliases?: readonly string[];
    readonly repeatable?: boolean;
    readonly required?: boolean;
    readonly valueArity?: OptionValueArity;
    readonly optionLookingValuePolicy?: OptionLookingValuePolicy;
    readonly placement?: "after-route" | "anywhere";
    readonly metavar?: string;
    readonly description?: string;
  }[];
}

export interface ProductDiscovery {
  readonly name: string;
  readonly commands: readonly CommandDiscovery[];
}

export interface DiscoveryRequest {
  /** Include commands whose routes are children of this root/domain route. */
  readonly route?: readonly string[];
}

function compareCommands(
  left: { readonly route: readonly string[]; readonly id: string },
  right: { readonly route: readonly string[]; readonly id: string },
): number {
  const leftRoute = left.route.join(" ");
  const rightRoute = right.route.join(" ");
  return leftRoute < rightRoute ? -1 : leftRoute > rightRoute ? 1 : left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export function projectDiscovery<const Catalog extends CommandCatalog>(
  product: CompiledProduct<Catalog>,
  request: DiscoveryRequest = {},
): ProductDiscovery {
  const commands = product.commands
    .filter((command) => request.route === undefined || (
      request.route.length <= command.route.length &&
      request.route.every((segment, index) => command.route[index] === segment)
    ))
    .sort(compareCommands);
  return {
    name: product.name,
    commands: commands.map((command) => ({
      id: command.id,
      route: [...command.route],
      summary: command.summary,
      ...(command.description === undefined ? {} : { description: command.description }),
      ...(command.examples === undefined ? {} : { examples: [...command.examples] }),
      fields: command.fields.map((field) => ({
        ...field,
        ...(field.aliases === undefined ? {} : { aliases: [...field.aliases] }),
      })),
    })),
  };
}
