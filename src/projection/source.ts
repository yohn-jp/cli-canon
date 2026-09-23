import type { CompiledField } from "../command/compiler.js";

export interface ProjectionCommandSource {
  readonly id: string;
  readonly route: readonly string[];
  readonly summary: string;
  readonly visibility?: "public" | "private";
  readonly description?: string;
  readonly examples?: readonly string[];
  readonly fields: readonly CompiledField[];
}

export interface ProjectionProductSource {
  readonly name: string;
  readonly commands: readonly ProjectionCommandSource[];
}
