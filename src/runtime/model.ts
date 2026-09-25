import type { HandlerMap } from "../command/handlers.js";
import type { CommandCatalog, CommandId, CommandResultOutput } from "../command/model.js";
import type { CommandTreeCommandNode, CommandTreeRootNode } from "../command/tree.js";
import type { CanonicalCommandSource, ComposedCommandTree, DelegatedCommandSource } from "../composition/model.js";
import type { PresentationMode } from "../output/model.js";
import type { ProductPackageIdentity } from "../product/identity.js";
import type { HelpOutputMode, HelpProjectionProduct, ParsedHelpMode } from "../projection/help.js";

/**
 * A canonical command request produced by a parser/presentation adapter.
 *
 * `route` is resolved against the compiled canonical command tree. `input` carries
 * undecoded field tokens keyed by declared field key:
 * - positional: `string | undefined`
 * - option: `string | undefined`, or `true` for an optional-value option given without a value
 * - repeatable option: `readonly (string | true)[] | undefined`
 * - flag: `boolean | undefined`
 * - raw args: `readonly string[] | undefined`
 *
 * Tokens are decoded and validated by the runtime; handlers never receive them.
 */
export interface CanonicalCommandRequest {
  readonly route: readonly string[];
  readonly input?: Readonly<Record<string, unknown>>;
}

/** The compiled product surface the semantic runtime consumes. */
export interface CanonicalRuntimeProduct<Catalog extends CommandCatalog = CommandCatalog> {
  readonly tree: CommandTreeRootNode<any, Catalog>;
  readonly handlers: HandlerMap<Catalog>;
  /** Canonical package identity used by the standard-shell version request. */
  readonly packageMetadata?: ProductPackageIdentity;
}

/** Runtime-owned request classifications. Parser/backend diagnostics are never part of this contract. */
export type CanonicalUsageFailureCode =
  "unknown-command" | "no-command" | "missing-required-option" | "missing-positional-argument" | "invalid-help-mode";

export interface CanonicalUsageFailure {
  readonly code: CanonicalUsageFailureCode;
  readonly route: readonly string[];
  readonly commandId?: string;
  readonly field?: string;
  readonly option?: string;
  /** The rejected help mode for `invalid-help-mode`. */
  readonly value?: string;
}

export type CanonicalFailureKind = "usage" | "validation" | "handler-result" | "handler-error" | "unexpected";

/** A typed command result, available with its command identity before any presentation. */
export type CanonicalExecutionSuccess<Catalog extends CommandCatalog = CommandCatalog> = {
  readonly [Id in CommandId<Catalog>]: {
    readonly status: "success";
    readonly commandId: Id;
    readonly route: Catalog[Id]["route"];
    readonly result: CommandResultOutput<Catalog[Id]>;
  };
}[CommandId<Catalog>];

export type CanonicalExecutionFailure<Catalog extends CommandCatalog = CommandCatalog> =
  | {
      readonly status: "failure";
      readonly failureKind: "usage";
      readonly usageFailure: CanonicalUsageFailure;
    }
  | {
      /** A declared field token failed schema decoding; the handler was not invoked. */
      readonly status: "failure";
      readonly failureKind: "validation";
      readonly commandId: CommandId<Catalog>;
      readonly field: string;
      readonly error: unknown;
    }
  | {
      /** The handler returned a value that does not satisfy the declared result schema. */
      readonly status: "failure";
      readonly failureKind: "handler-result";
      readonly commandId: CommandId<Catalog>;
      readonly error: unknown;
    }
  | {
      /** The product handler threw or rejected; domain errors are mapped by the product, not by the runtime. */
      readonly status: "failure";
      readonly failureKind: "handler-error";
      readonly commandId: CommandId<Catalog>;
      readonly error: unknown;
    }
  | {
      /** A failure outside handler execution, such as a malformed adapter request or broken handler binding. */
      readonly status: "failure";
      readonly failureKind: "unexpected";
      readonly commandId?: CommandId<Catalog>;
      readonly error: unknown;
    };

/** Semantic outcome of one canonical execution, independent of stdout/stderr serialization. */
export type CanonicalExecutionOutcome<Catalog extends CommandCatalog = CommandCatalog> =
  CanonicalExecutionSuccess<Catalog> | CanonicalExecutionFailure<Catalog>;

/** The route position at which an argv backend parses options preceding the next route operand. */
export type CanonicalArgvScope =
  { readonly kind: "root" } | { readonly kind: "group"; readonly route: readonly string[] };

export type CanonicalArgvParse<Value extends object, Failure> =
  ({ readonly status: "parsed" } & Value) | { readonly status: "failure"; readonly failure: Failure };

/**
 * Argv grammar backend for the canonical argv path.
 *
 * The backend only tokenizes options and operands. Help intent, route/command
 * resolution, required-input classification, and decoding belong to the runtime.
 */
export interface CanonicalArgvBackend<Failure, RootState = unknown> {
  /** Parses the options accepted at `scope` up to the first operand and returns the remaining argv verbatim. */
  parseLeading(
    scope: CanonicalArgvScope,
    argv: readonly string[],
  ): CanonicalArgvParse<{ readonly operands: readonly string[]; readonly state: RootState }, Failure>;
  /** Parses the argv following a runtime-resolved command route into undecoded canonical field tokens. */
  parseCommand(
    command: CommandTreeCommandNode,
    argv: readonly string[],
    root: RootState,
  ): CanonicalArgvParse<{ readonly input: Readonly<Record<string, unknown>> }, Failure>;
}

export interface CanonicalArgvRequest<Failure, RootState = unknown> {
  readonly argv: readonly string[];
  readonly backend: CanonicalArgvBackend<Failure, RootState>;
  /** Help surface against which the runtime resolves help intent before any grammar parsing. */
  readonly help: HelpProjectionProduct;
  readonly helpFormat?: HelpOutputMode | "text";
}

/** Attaches the invocation's Canon-resolved presentation mode to each outcome member. */
type WithPresentation<Outcome> = Outcome extends unknown
  ? Outcome & { readonly presentation: PresentationMode }
  : never;

/**
 * Semantic outcome of one argv invocation: help intent, a version request, a backend grammar
 * failure, or a canonical execution. Every member carries the presentation mode resolved
 * once by the standard shell before route resolution.
 */
export type CanonicalArgvOutcome<Catalog extends CommandCatalog = CommandCatalog, Failure = unknown> = WithPresentation<
  | CanonicalExecutionOutcome<Catalog>
  | { readonly status: "help"; readonly help: ParsedHelpMode }
  | { readonly status: "version"; readonly packageMetadata: ProductPackageIdentity }
  | { readonly status: "failure"; readonly failureKind: "grammar"; readonly grammarFailure: Failure }
>;

/**
 * The one executor boundary a delegated source crosses for a route it owns.
 *
 * Canon has already resolved the owner and route from the composed tree; `argv`
 * is the remaining argv following the resolved route, verbatim except that Canon
 * shell `--json` selectors are removed. The delegated source owns its grammar and
 * domain semantics for that argv, and receives the resolved presentation mode.
 */
export interface DelegatedCommandRequest<SourceId extends string = string> {
  readonly sourceId: SourceId;
  readonly commandId: string;
  readonly route: readonly [string, ...string[]];
  readonly argv: readonly string[];
  readonly presentation: PresentationMode;
}

export type DelegatedCommandExecutor<Result = unknown> = (request: DelegatedCommandRequest) => Result | Promise<Result>;

/** A delegated source together with its explicit executor boundary. Composition reads only its structure. */
export interface ExecutableDelegatedCommandSource<
  SourceId extends string = string,
  Result = unknown,
> extends DelegatedCommandSource<SourceId> {
  readonly execute: DelegatedCommandExecutor<Result>;
}

export type ExecutableCommandSource<SourceId extends string = string, Result = unknown> =
  CanonicalCommandSource<SourceId> | ExecutableDelegatedCommandSource<SourceId, Result>;

/** A composed tree and the sources whose owners it resolves; owners are looked up by source ID. */
export interface ComposedRuntimeProduct<SourceId extends string = string, Result = unknown> {
  readonly tree: ComposedCommandTree<SourceId>;
  readonly sources: readonly ExecutableCommandSource<SourceId, Result>[];
}

/** Semantic outcome of one argv invocation dispatched to exactly one composed owner. */
export type ComposedArgvOutcome<Failure = unknown, Result = unknown, SourceId extends string = string> =
  | CanonicalArgvOutcome<CommandCatalog, Failure>
  | WithPresentation<
      | {
          /** The delegated executor returned; its result is owned by the delegated source. */
          readonly status: "delegated";
          readonly sourceId: SourceId;
          readonly commandId: string;
          readonly route: readonly [string, ...string[]];
          readonly result: Result;
        }
      | {
          /** The delegated executor threw or rejected. No other source is tried. */
          readonly status: "failure";
          readonly failureKind: "delegated-error";
          readonly sourceId: SourceId;
          readonly commandId: string;
          readonly error: unknown;
        }
    >;

export class CanonicalRequestError extends Error {
  readonly code = "INVALID_CANONICAL_REQUEST" as const;
  readonly field: string | undefined;

  constructor(message: string, field?: string) {
    super(message);
    this.name = "CanonicalRequestError";
    this.field = field;
  }
}
