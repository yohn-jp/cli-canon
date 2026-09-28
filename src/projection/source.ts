import type { CommandProminence } from "../command/model.js";
import type { CompiledField } from "../command/compiler.js";

export interface ProjectionCommandSource {
  readonly id: string;
  readonly route: readonly string[];
  readonly summary: string;
  readonly visibility?: "public" | "private";
  /** Resolved presentation-only help prominence; absent is `primary`. */
  readonly prominence?: CommandProminence;
  readonly description?: string;
  readonly examples?: readonly string[];
  readonly fields: readonly CompiledField[];
}

export interface ProjectionProductSource {
  readonly name: string;
  readonly description?: string;
  readonly commands: readonly ProjectionCommandSource[];
}
