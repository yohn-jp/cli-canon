export type CliFailureKind =
  "usage" | "validation" | "domain" | "handler-result" | "serialization" | "budget" | "unexpected";

export type CliStream = "stdout" | "stderr";

/**
 * Invocation presentation mode resolved once by the Canon standard shell.
 *
 * `machine` is selected by the `--json` shell token; otherwise the mode is `human`.
 * The mode changes encoding only, never stream or exit code.
 */
export type PresentationMode = "human" | "machine";

export interface CliSuccess {
  readonly status: "success";
  readonly stream: "stdout";
  readonly output: string;
  readonly exitCode: 0;
}

export interface CliFailure {
  readonly status: "failure";
  readonly stream: CliStream;
  readonly output: string;
  readonly exitCode: number;
  readonly failureKind: CliFailureKind;
}

export type CliOutcome = CliSuccess | CliFailure;

/** Compatibility shape returned by the Node runner. */
export interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly failureKind?: CliFailureKind;
}

/** Output callbacks supplied by the product composition root. */
export interface CliIO {
  readonly writeStdout: (output: string) => void;
  readonly writeStderr: (output: string) => void;
}

export interface OutputPolicyOptions {
  /** Maximum UTF-8 bytes in the final output, including any newline. */
  readonly maxBytes?: number;
}

export interface JsonOutputPolicyOptions extends OutputPolicyOptions {
  readonly space?: string | number;
}

export interface DomainFailureMapping {
  readonly exitCode: number;
  readonly stream: CliStream;
  readonly output: string;
}

/**
 * A product-owned type guard and mapping; CLI Canon assigns only the domain classification.
 * `map` receives the invocation's Canon-resolved presentation mode.
 */
export interface DomainErrorAdapter<DomainError> {
  readonly is: (error: unknown) => error is DomainError;
  readonly map: (error: DomainError, presentation: PresentationMode) => DomainFailureMapping;
}
