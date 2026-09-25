import type { HandlerMap } from "../command/handlers.js";
import type { CommandCatalog, CommandId, CommandResultOutput, GroupCatalog } from "../command/model.js";
import type { CommandTreeCommandNode, CommandTreeRootNode } from "../command/tree.js";
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
  readonly tree: CommandTreeRootNode<GroupCatalog, Catalog>;
  readonly handlers: HandlerMap<Catalog>;
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

/** Semantic outcome of one argv invocation: help intent, a backend grammar failure, or a canonical execution. */
export type CanonicalArgvOutcome<Catalog extends CommandCatalog = CommandCatalog, Failure = unknown> =
  | CanonicalExecutionOutcome<Catalog>
  | { readonly status: "help"; readonly help: ParsedHelpMode }
  | { readonly status: "failure"; readonly failureKind: "grammar"; readonly grammarFailure: Failure };

export class CanonicalRequestError extends Error {
  readonly code = "INVALID_CANONICAL_REQUEST" as const;
  readonly field: string | undefined;

  constructor(message: string, field?: string) {
    super(message);
    this.name = "CanonicalRequestError";
    this.field = field;
  }
}
