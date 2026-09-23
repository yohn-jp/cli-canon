import assert from "node:assert/strict";
import test from "node:test";
import * as z from "zod";
import {
  CanonConstructionError,
  SchemaProjectionError,
  bindHandlers,
  compileProduct,
  defineCommands,
  flag,
  option,
  positional,
  projectDiscovery,
  projectProductSchemas,
  projectSchema,
  rawArgs,
} from "../../dist/index.js";

function product(packageMetadata) {
  const commands = defineCommands({
    "document.inspect": {
      route: ["document", "inspect"],
      summary: "Inspect a document.",
      input: {
        file: positional(z.string().min(2)),
        format: option("--format", z.enum(["text", "json"])),
        verbose: flag("--verbose"),
        args: rawArgs(),
      },
      result: z.object({ length: z.number().int() }),
    },
  });
  const handlers = bindHandlers(commands)({
    "document.inspect": ({ file }) => ({ length: file.length }),
  });
  return compileProduct({ name: "document-cli", packageMetadata, commands, handlers });
}

test("discovery projects only package name, version, and bin identity as JSON data", () => {
  const packageMetadata = {
    name: "@example/document-cli",
    version: "3.2.1",
    bin: { document: "./dist/cli.js" },
    description: "not part of the public product identity",
    privateKey: () => "not serializable",
  };
  const compiled = product(packageMetadata);
  packageMetadata.bin.document = "./changed.js";

  const discovery = projectDiscovery(compiled);
  assert.deepEqual(discovery.packageMetadata, {
    name: "@example/document-cli",
    version: "3.2.1",
    bin: { document: "./dist/cli.js" },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(discovery)), discovery);
  assert.equal("handlers" in discovery, false);
  assert.equal("privateKey" in discovery.packageMetadata, false);
});

test("invalid package identity fails product construction", () => {
  assert.throws(
    () => product({ name: "document-cli", version: "" }),
    (error) =>
      error instanceof CanonConstructionError &&
      error.issues.some((issue) => issue.code === "INVALID_PRODUCT_IDENTITY"),
  );
});

test("compiled input and output schemas expose complete JSON Schema projections", () => {
  const schemas = projectProductSchemas(product(undefined), "complete");
  const command = schemas.find((entry) => entry.commandId === "document.inspect");
  assert.equal(command?.input.file.io, "input");
  assert.equal(command?.input.file.completeness, "complete");
  assert.deepEqual(command?.input.file.schema, {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "string",
    minLength: 2,
  });
  assert.equal(command?.output.io, "output");
  assert.equal(command?.input.verbose.schema.type, "boolean");
  assert.deepEqual(command?.input.args.schema.items, { type: "string" });
  assert.deepEqual(command?.output.schema.properties?.length, {
    type: "integer",
    minimum: -Number.MAX_SAFE_INTEGER,
    maximum: Number.MAX_SAFE_INTEGER,
  });
});

test("declared complete schema projection is admitted during product construction", () => {
  const commands = defineCommands({
    read: {
      route: ["read"],
      summary: "Read.",
      input: { value: positional(z.string().refine((value) => value !== "reserved")) },
      result: z.object({ value: z.string() }),
    },
  });
  const handlers = bindHandlers(commands)({ read: ({ value }) => ({ value }) });
  assert.throws(
    () =>
      compileProduct({
        name: "fixture",
        commands,
        handlers,
        schemaProjectionCompleteness: "complete",
      }),
    (error) =>
      error instanceof CanonConstructionError &&
      error.issues.some((issue) => issue.code === "UNSUPPORTED_SCHEMA_PROJECTION"),
  );

  const structural = compileProduct({
    name: "fixture",
    commands,
    handlers,
    schemaProjectionCompleteness: "structural-only",
  });
  assert.equal(structural.schemaProjectionCompleteness, "structural-only");
});

test("schema projections label structural-only output and reject unsupported complete claims", () => {
  const transformed = z.string().transform((value) => value.length);
  const input = projectSchema(transformed, { io: "input", completeness: "complete" });
  assert.equal(input.schema.type, "string");

  assert.throws(
    () => projectSchema(transformed, { io: "output", completeness: "complete" }),
    (error) => error instanceof SchemaProjectionError && error.io === "output",
  );
  const output = projectSchema(transformed, { io: "output", completeness: "structural-only" });
  assert.equal(output.completeness, "structural-only");
  assert.equal("type" in output.schema, false);

  const refined = z.string().refine((value) => value !== "reserved");
  assert.throws(
    () => projectSchema(refined, { io: "input", completeness: "complete" }),
    (error) => error instanceof SchemaProjectionError && error.code === "UNSUPPORTED_COMPLETE_SCHEMA_PROJECTION",
  );
  assert.equal(projectSchema(refined, { io: "input", completeness: "structural-only" }).schema.type, "string");
});
