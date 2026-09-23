import type { ProjectionCommandSource } from "./source.js";
import type { ProductPackageIdentity } from "../product/identity.js";
import type { OptionLookingValuePolicy, OptionValueArity } from "../command/model.js";
import type { CompiledField } from "../command/compiler.js";
import { CanonConstructionError, type CanonConstructionIssue } from "../command/errors.js";

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
  readonly packageMetadata?: ProductPackageIdentity;
  readonly commands: readonly CommandDiscovery[];
}

export interface DiscoveryRequest {
  /** Include commands whose routes are children of this root/domain route. */
  readonly route?: readonly string[];
}

export interface DiscoveryProjectionProduct {
  readonly name: string;
  readonly packageMetadata?: ProductPackageIdentity;
  readonly commands: readonly ProjectionCommandSource[];
}

/** Bounded presentation metadata for one route that is still owned by a consumer. */
export interface LegacyRouteDescriptor {
  readonly id: string;
  readonly route: readonly [string, ...string[]];
  readonly summary: string;
  readonly description?: string;
  readonly examples?: readonly string[];
  readonly fields: readonly CompiledField[];
}

export interface ComposedCommandProjection extends DiscoveryProjectionProduct {}

function projectPackageMetadata(packageMetadata: ProductPackageIdentity): ProductPackageIdentity {
  return {
    name: packageMetadata.name,
    version: packageMetadata.version,
    ...(packageMetadata.bin === undefined
      ? {}
      : {
          bin: typeof packageMetadata.bin === "string" ? packageMetadata.bin : { ...packageMetadata.bin },
        }),
  };
}

function compareCommands(
  left: { readonly route: readonly string[]; readonly id: string },
  right: { readonly route: readonly string[]; readonly id: string },
): number {
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
}

export function projectDiscovery(
  product: DiscoveryProjectionProduct,
  request: DiscoveryRequest = {},
): ProductDiscovery {
  const commands = product.commands
    .filter(
      (command) =>
        request.route === undefined ||
        (request.route.length <= command.route.length &&
          request.route.every((segment, index) => command.route[index] === segment)),
    )
    .sort(compareCommands);
  return {
    name: product.name,
    ...(product.packageMetadata === undefined
      ? {}
      : { packageMetadata: projectPackageMetadata(product.packageMetadata) }),
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

function routesOverlap(left: readonly string[], right: readonly string[]): boolean {
  const sharedLength = Math.min(left.length, right.length);
  return left.slice(0, sharedLength).every((segment, index) => segment === right[index]);
}

/**
 * Combines Canon-owned routes with bounded descriptors for routes still owned
 * by a consumer. Shared parent groups are allowed; one route cannot own or
 * overlap another route's leaf.
 */
export function composeCommandProjection(
  product: DiscoveryProjectionProduct,
  legacyRoutes: readonly LegacyRouteDescriptor[],
): ComposedCommandProjection {
  const commands: ProjectionCommandSource[] = [
    ...product.commands,
    ...legacyRoutes.map((route) => ({
      id: route.id,
      route: route.route,
      summary: route.summary,
      ...(route.description === undefined ? {} : { description: route.description }),
      ...(route.examples === undefined ? {} : { examples: route.examples }),
      fields: route.fields,
    })),
  ];
  const issues: CanonConstructionIssue[] = [];

  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index];
    if (command === undefined) continue;
    if (
      !Array.isArray(command.route) ||
      command.route.length === 0 ||
      command.route.some((segment) => typeof segment !== "string" || segment.trim().length === 0 || /\s/u.test(segment))
    ) {
      issues.push({
        code: "INVALID_ROUTE",
        commandId: command.id,
        message: `command ${command.id} has an empty route or route segment`,
      });
    }
    for (let otherIndex = index + 1; otherIndex < commands.length; otherIndex += 1) {
      const other = commands[otherIndex];
      if (other === undefined) continue;
      if (command.route.length === other.route.length && routesOverlap(command.route, other.route)) {
        issues.push({
          code: "DUPLICATE_ROUTE",
          commandId: other.id,
          message: `commands ${command.id} and ${other.id} claim the same route`,
        });
      } else if (routesOverlap(command.route, other.route)) {
        issues.push({
          code: "OVERLAPPING_ROUTE",
          commandId: other.id,
          message: `command routes ${command.route.join(" ")} and ${other.route.join(" ")} overlap`,
        });
      } else if (command.id === other.id) {
        issues.push({
          code: "DUPLICATE_COMMAND_ID",
          commandId: other.id,
          message: `commands ${command.id} and ${other.id} use the same command id`,
        });
      }
    }
  }

  if (issues.length > 0) throw new CanonConstructionError(issues);

  return Object.freeze({
    name: product.name,
    ...(product.packageMetadata === undefined
      ? {}
      : { packageMetadata: Object.freeze(projectPackageMetadata(product.packageMetadata)) }),
    commands: Object.freeze(
      commands.map((command) =>
        Object.freeze({
          ...command,
          route: Object.freeze([...command.route]),
          ...(command.examples === undefined ? {} : { examples: Object.freeze([...command.examples]) }),
          fields: Object.freeze(
            command.fields.map((field) =>
              Object.freeze({
                ...field,
                ...(field.aliases === undefined ? {} : { aliases: Object.freeze([...field.aliases]) }),
              }),
            ),
          ),
        }),
      ),
    ),
  });
}
