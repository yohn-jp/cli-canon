import type * as z from "zod";
import type { CompiledField } from "../command/compiler.js";
import type { FieldDefinition } from "../command/model.js";

export interface ProjectionCommandSource {
  readonly id: string;
  readonly route: readonly string[];
  readonly summary: string;
  readonly visibility: "public" | "private";
  readonly description?: string;
  readonly examples?: readonly string[];
  readonly fields: readonly CompiledField[];
  readonly definition: {
    readonly input: Readonly<Record<string, FieldDefinition>>;
    readonly result: z.ZodType;
  };
}

export interface ProjectionProductSource {
  readonly name: string;
  readonly commands: readonly ProjectionCommandSource[];
}
