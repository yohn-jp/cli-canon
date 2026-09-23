import type {
  CliFailure,
  CliFailureKind,
  CliIO,
  CliOutcome,
  CliResult,
  CliSuccess,
  JsonOutputPolicyOptions,
  OutputPolicyOptions,
} from "./model.js";

const encoder = new TextEncoder();

export function utf8ByteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

export function cliSuccess(output: string): CliSuccess {
  return { status: "success", stream: "stdout", output, exitCode: 0 };
}

export function cliFailure(
  failureKind: CliFailureKind,
  output: string,
  exitCode = 1,
  stream: CliFailure["stream"] = "stderr",
): CliFailure {
  return { status: "failure", failureKind, stream, output, exitCode };
}

function boundedFailure(
  failureKind: "serialization",
  output: string,
  options: OutputPolicyOptions,
): CliOutcome {
  const maxBytes = options.maxBytes;
  if (maxBytes === undefined) return cliFailure(failureKind, output);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    return cliFailure("budget", "OUTPUT_BUDGET_INVALID: maxBytes must be a non-negative safe integer.\n");
  }
  if (utf8ByteLength(output) <= maxBytes) return cliFailure(failureKind, output);

  const brief = "OUTPUT_SERIALIZATION_FAILED\n";
  return cliFailure(failureKind, utf8ByteLength(brief) <= maxBytes ? brief : "");
}

function boundedSuccess(output: string, options: OutputPolicyOptions): CliOutcome {
  const maxBytes = options.maxBytes;
  if (maxBytes === undefined) return cliSuccess(output);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    return cliFailure("budget", "OUTPUT_BUDGET_INVALID: maxBytes must be a non-negative safe integer.\n");
  }

  const bytes = utf8ByteLength(output);
  if (bytes <= maxBytes) return cliSuccess(output);

  const detail = `OUTPUT_BUDGET_EXCEEDED: output uses ${bytes} UTF-8 bytes; limit is ${maxBytes} bytes.\n`;
  const brief = "OUTPUT_BUDGET_EXCEEDED\n";
  const diagnostic = utf8ByteLength(detail) <= maxBytes
    ? detail
    : utf8ByteLength(brief) <= maxBytes
      ? brief
      : "";
  return cliFailure("budget", diagnostic);
}

/** Encodes already-serialized text and checks its final UTF-8 byte size. */
export function textOutput(output: string, options: OutputPolicyOptions = {}): CliOutcome {
  return boundedSuccess(output, options);
}

function strictJsonValue(key: string, value: unknown): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError(`non-finite number at ${key || "<root>"}`);
  }
  if (
    value === undefined ||
    typeof value === "bigint" ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    throw new TypeError(`unsupported JSON value at ${key || "<root>"}: ${typeof value}`);
  }
  return value;
}

/** Serializes a complete JSON document without silent JSON coercions, appends its final newline, then applies the byte budget. */
export function jsonOutput(
  value: unknown,
  options: JsonOutputPolicyOptions = {},
): CliOutcome {
  try {
    const json = JSON.stringify(value, strictJsonValue, options.space);
    if (json === undefined) {
      return boundedFailure(
        "serialization",
        "OUTPUT_SERIALIZATION_FAILED: value is not JSON serializable.\n",
        options,
      );
    }
    return boundedSuccess(`${json}\n`, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return boundedFailure("serialization", `OUTPUT_SERIALIZATION_FAILED: ${message}\n`, options);
  }
}

export function toCliResult(outcome: CliOutcome): CliResult {
  if (outcome.status === "success") {
    return { exitCode: outcome.exitCode, stdout: outcome.output, stderr: "" };
  }
  return {
    exitCode: outcome.exitCode,
    stdout: outcome.stream === "stdout" ? outcome.output : "",
    stderr: outcome.stream === "stderr" ? outcome.output : "",
    failureKind: outcome.failureKind,
  };
}

export function writeCliOutcome(outcome: CliOutcome, io: CliIO): void {
  if (outcome.stream === "stdout") io.writeStdout(outcome.output);
  else io.writeStderr(outcome.output);
}
