import * as z from "zod";
import type { CompiledProduct } from "../command/compiler.js";
import type { CommandCatalog } from "../command/model.js";

export type SchemaProjectionCompleteness = "complete" | "structural-only";
export type SchemaProjectionIO = "input" | "output";

export interface SchemaProjectionOptions {
  readonly io: SchemaProjectionIO;
  readonly completeness: SchemaProjectionCompleteness;
}

export interface SchemaProjection {
  readonly io: SchemaProjectionIO;
  readonly completeness: SchemaProjectionCompleteness;
  readonly schema: z.core.JSONSchema.BaseSchema;
}

export interface CommandSchemaProjection {
  readonly commandId: string;
  readonly input: Readonly<Record<string, SchemaProjection>>;
  readonly output: SchemaProjection;
}

export interface SchemaProjectionProduct<Catalog extends CommandCatalog = CommandCatalog> {
  readonly commands: CompiledProduct<Catalog>["commands"];
}

const JSON_SCHEMA_CHECKS = [
  "greater_than",
  "less_than",
  "multiple_of",
  "number_format",
  "bigint_format",
  "min_length",
  "max_length",
  "length_equals",
  "min_size",
  "max_size",
  "size_equals",
  "string_format",
  "mime_type",
] as const;

export class SchemaProjectionError extends Error {
  readonly code = "UNSUPPORTED_COMPLETE_SCHEMA_PROJECTION" as const;
  readonly io: SchemaProjectionIO;
  readonly path: readonly (string | number)[];

  constructor(io: SchemaProjectionIO, path: readonly (string | number)[], message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "SchemaProjectionError";
    this.io = io;
    this.path = Object.freeze([...path]);
  }
}

/** Project a framework-owned Zod schema without presenting dropped checks as complete. */
export function projectSchema<Schema extends z.ZodType>(
  schema: Schema,
  options: SchemaProjectionOptions,
): SchemaProjection {
  const projectionOptions = options.completeness === "complete"
    ? {
        io: options.io,
        unrepresentable: "throw" as const,
        override: ({ zodSchema, path }: {
          readonly zodSchema: z.core.$ZodTypes;
          readonly path: (string | number)[];
        }) => {
          const unsupportedCheck = zodSchema._zod.def.checks?.find((check) =>
            !JSON_SCHEMA_CHECKS.some((supported) => supported === check._zod.def.check),
          );
          if (unsupportedCheck !== undefined) {
            throw new SchemaProjectionError(
              options.io,
              path,
              `Complete ${options.io} schema projection does not support Zod check ${unsupportedCheck._zod.def.check}`,
            );
          }
        },
      }
    : {
        io: options.io,
        unrepresentable: "any" as const,
      };

  try {
    return Object.freeze({
      io: options.io,
      completeness: options.completeness,
      schema: z.toJSONSchema(schema, projectionOptions),
    });
  } catch (cause) {
    if (cause instanceof SchemaProjectionError) throw cause;
    if (options.completeness === "complete") {
      throw new SchemaProjectionError(
        options.io,
        [],
        `Complete ${options.io} schema projection is unsupported: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause,
      );
    }
    throw cause;
  }
}

/** Project every declared input value schema and handler result schema from a compiled product. */
export function projectProductSchemas<const Catalog extends CommandCatalog>(
  product: SchemaProjectionProduct<Catalog>,
  completeness: SchemaProjectionCompleteness,
): readonly CommandSchemaProjection[] {
  return Object.freeze(product.commands.map((command) => {
    const inputEntries: [string, SchemaProjection][] = [];
    for (const fieldKey of Object.keys(command.definition.input)) {
      const field = command.definition.input[fieldKey];
      if (field === undefined) continue;
      if (field.kind === "positional" || field.kind === "option") {
        inputEntries.push([fieldKey, projectSchema(field.schema, { io: "input", completeness })]);
      } else if (field.kind === "flag") {
        inputEntries.push([fieldKey, projectSchema(z.boolean(), { io: "input", completeness })]);
      } else {
        inputEntries.push([fieldKey, projectSchema(z.array(z.string()), { io: "input", completeness })]);
      }
    }
    return Object.freeze({
      commandId: command.id,
      input: Object.freeze(Object.fromEntries(inputEntries)),
      output: projectSchema(command.definition.result, { io: "output", completeness }),
    });
  }));
}
