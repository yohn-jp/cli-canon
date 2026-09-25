import type { CompiledField, CompiledProduct } from "../command/compiler.js";
import type { CommandVisibility } from "../command/model.js";

/**
 * Any compiled product, whatever its command, skill, path, and group catalogs.
 * Composition reads only its canonical tree and compiled command fields.
 */
export type AnyCompiledProduct = CompiledProduct<any, any, any, any>;

/** Explicit kinds of command source that may contribute structure to a composed tree. */
export type CommandSourceKind = "canonical" | "delegated";

/**
 * A Canon-owned source. Its structural contribution is the compiled canonical
 * command tree of the product; every route it contributes is owned by Canon.
 */
export interface CanonicalCommandSource<
  SourceId extends string = string,
  Product extends AnyCompiledProduct = AnyCompiledProduct,
> {
  readonly kind: "canonical";
  readonly id: SourceId;
  readonly product: Product;
}

/** Bounded structural metadata for one non-executable group contributed by a delegated source. */
export interface DelegatedGroupDescriptor {
  readonly id: string;
  readonly route: readonly [string, ...string[]];
  readonly summary: string;
  readonly description?: string;
  readonly visibility?: CommandVisibility;
  readonly examples?: readonly string[];
}

/** Bounded structural metadata for one executable route owned by a delegated source. */
export interface DelegatedCommandDescriptor {
  readonly id: string;
  readonly route: readonly [string, ...string[]];
  readonly summary: string;
  readonly description?: string;
  readonly visibility?: CommandVisibility;
  readonly examples?: readonly string[];
  readonly fields: readonly CompiledField[];
}

/**
 * An explicitly delegated source. It contributes only bounded structural
 * descriptors; composition never executes it.
 */
export interface DelegatedCommandSource<SourceId extends string = string> {
  readonly kind: "delegated";
  readonly id: SourceId;
  readonly groups?: readonly DelegatedGroupDescriptor[];
  readonly commands: readonly DelegatedCommandDescriptor[];
}

export type CommandSource<SourceId extends string = string> =
  CanonicalCommandSource<SourceId> | DelegatedCommandSource<SourceId>;

/** The single source that owns a composed node, known before any execution. */
export interface CommandSourceOwner<SourceId extends string = string> {
  readonly kind: CommandSourceKind;
  readonly sourceId: SourceId;
}

/** An executable composed route with exactly one owning source. */
export interface ComposedCommandNode<SourceId extends string = string> {
  readonly kind: "command";
  readonly id: string;
  readonly route: readonly [string, ...string[]];
  readonly owner: CommandSourceOwner<SourceId>;
  readonly summary: string;
  readonly description?: string;
  readonly visibility: CommandVisibility;
  readonly examples?: readonly string[];
  readonly fields: readonly CompiledField[];
}

/**
 * A non-executable composed group. Its presentation is declared by exactly one
 * source, while its children may be owned by different sources.
 */
export interface ComposedGroupNode<SourceId extends string = string> {
  readonly kind: "group";
  readonly id: string;
  readonly route: readonly [string, ...string[]];
  readonly owner: CommandSourceOwner<SourceId>;
  readonly summary: string;
  readonly description?: string;
  readonly visibility: CommandVisibility;
  readonly examples?: readonly string[];
  readonly children: readonly ComposedChildNode<SourceId>[];
}

export type ComposedChildNode<SourceId extends string = string> =
  ComposedGroupNode<SourceId> | ComposedCommandNode<SourceId>;

/** The composed product root. It has no route of its own and is not executable. */
export interface ComposedRootNode<SourceId extends string = string> {
  readonly kind: "root";
  readonly children: readonly ComposedChildNode<SourceId>[];
}

/** The one resolved tree produced from all command sources. */
export interface ComposedCommandTree<SourceId extends string = string> {
  /** Source identities in deterministic source-ID order. */
  readonly sources: readonly CommandSourceOwner<SourceId>[];
  readonly root: ComposedRootNode<SourceId>;
}

export type CommandSourceId<Sources extends readonly CommandSource[]> = Sources[number]["id"];
