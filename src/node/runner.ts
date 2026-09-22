import type { CommandCatalog } from "../command/model.js";
import type { CompiledProduct } from "../command/compiler.js";

export type CliFailureKind =
  | "usage"
  | "validation"
  | "handler-result"
  | "unexpected";

export interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly failureKind?: CliFailureKind;
}

export interface RunNodeCliOptions {
  readonly helpFormat?: "text" | "json";
}

/**
 * Private-Commander runtime adapter. It may parse argv and invoke a selected
 * handler, but it must not call process.exit(), console.*, or register signals.
 */
export declare function runNodeCli<const Catalog extends CommandCatalog>(
  product: CompiledProduct<Catalog>,
  argv: readonly string[],
  options?: RunNodeCliOptions,
): Promise<CliResult>;
