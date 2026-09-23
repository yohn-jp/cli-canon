import assert from "node:assert/strict";
import test from "node:test";
import * as z from "zod";
import {
  bindHandlers,
  cliFailure,
  compileProduct,
  defineCommands,
  jsonOutput,
  positional,
  toCliResult,
  utf8ByteLength,
  writeCliOutcome,
} from "../../dist/index.js";
import { runNodeCli } from "../../dist/node/index.js";

test("JSON byte budget includes Unicode and the final newline at below, exact, and above limits", () => {
  const value = { message: "雪" };
  const encoded = '{"message":"雪"}\n';
  const bytes = Buffer.byteLength(encoded, "utf8");

  const below = jsonOutput(value, { maxBytes: bytes - 1 });
  assert.equal(below.status, "failure");
  assert.equal(below.failureKind, "budget");
  assert.equal(below.stream, "stderr");
  assert.equal(below.output, "");
  assert.ok(Buffer.byteLength(below.output, "utf8") <= bytes - 1);

  const exact = jsonOutput(value, { maxBytes: bytes });
  assert.equal(exact.status, "success");
  assert.equal(exact.output, encoded);
  assert.equal(Buffer.byteLength(exact.output, "utf8"), bytes);
  assert.deepEqual(JSON.parse(exact.output), value);

  const above = jsonOutput(value, { maxBytes: bytes + 1 });
  assert.equal(above.status, "success");
  assert.equal(utf8ByteLength(above.output), bytes);
});

test("serialization failures are explicit non-success outcomes", () => {
  const circular = {};
  circular.self = circular;
  for (const value of [
    1n,
    circular,
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    { nested: undefined },
    { nested: () => "hidden" },
    { nested: Symbol("hidden") },
    { nested: [Number.NaN] },
  ]) {
    const result = jsonOutput(value);
    assert.equal(result.status, "failure");
    assert.equal(result.failureKind, "serialization");
    assert.equal(result.stream, "stderr");
    assert.notEqual(result.exitCode, 0);
  }
  const bounded = jsonOutput(1n, { maxBytes: 1 });
  assert.equal(bounded.status, "failure");
  assert.equal(bounded.failureKind, "serialization");
  assert.equal(Buffer.byteLength(bounded.output, "utf8"), 0);
});

test("CliIO writes the outcome stream while preserving its exit and failure classification", () => {
  const writes = [];
  const io = {
    writeStdout: (value) => writes.push(["stdout", value]),
    writeStderr: (value) => writes.push(["stderr", value]),
  };
  const success = jsonOutput({ ok: true });
  const failure = cliFailure("domain", "DOMAIN_DENIED\n", 7);

  writeCliOutcome(success, io);
  writeCliOutcome(failure, io);
  assert.deepEqual(writes, [["stdout", '{"ok":true}\n'], ["stderr", "DOMAIN_DENIED\n"]]);
  assert.deepEqual(toCliResult(failure), {
    exitCode: 7,
    stdout: "",
    stderr: "DOMAIN_DENIED\n",
    failureKind: "domain",
  });
});

test("Node runner uses the typed optional product domain error adapter", async () => {
  const commands = defineCommands({
    "document.read": {
      route: ["read"],
      summary: "Read a document.",
      input: { name: positional(z.string()) },
      result: z.unknown(),
    },
  });
  const handlers = bindHandlers(commands)({
    "document.read": () => {
      throw { code: "DOCUMENT_LOCKED", message: "Document is locked." };
    },
  });
  const product = compileProduct({ name: "fixture", commands, handlers });
  const domainErrorAdapter = {
    is: (error) => typeof error === "object" && error !== null
      && "code" in error && error.code === "DOCUMENT_LOCKED"
      && "message" in error && typeof error.message === "string",
    map: (error) => ({
      exitCode: 8,
      stream: "stderr",
      output: `${error.code}: ${error.message}\n`,
    }),
  };
  const result = await runNodeCli(product, ["read", "notes.md"], { domainErrorAdapter });
  assert.deepEqual(result, {
    exitCode: 8,
    stdout: "",
    stderr: "DOCUMENT_LOCKED: Document is locked.\n",
    failureKind: "domain",
  });
});

test("Node result rejects non-finite values instead of silently serializing them as null", async () => {
  const commands = defineCommands({
    read: {
      route: ["read"],
      summary: "Read.",
      input: {},
      result: z.unknown(),
    },
  });
  for (const value of [{ value: Number.NaN }, { value: Number.POSITIVE_INFINITY }]) {
    const product = compileProduct({
      name: "fixture",
      commands,
      handlers: bindHandlers(commands)({ read: () => value }),
    });
    const result = await runNodeCli(product, ["read"]);
    assert.equal(result.exitCode, 1);
    assert.equal(result.failureKind, "serialization");
    assert.match(result.stderr, /OUTPUT_SERIALIZATION_FAILED/);
    assert.equal(result.stdout, "");
  }
});

test("Node result serialization failure is distinct from handler-result validation", async () => {
  const commands = defineCommands({
    "document.read": {
      route: ["read"],
      summary: "Read a document.",
      input: {},
      result: z.unknown(),
    },
  });
  const handlers = bindHandlers(commands)({ "document.read": () => 1n });
  const product = compileProduct({ name: "fixture", commands, handlers });
  const result = await runNodeCli(product, ["read"]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.failureKind, "serialization");
  assert.match(result.stderr, /OUTPUT_SERIALIZATION_FAILED/);
});

test("Node runner applies the byte budget to the final response and preserves unexpected failures", async () => {
  const commands = defineCommands({
    "document.read": {
      route: ["read"],
      summary: "Read a document.",
      input: {},
      result: z.object({ message: z.string() }),
    },
  });
  const successProduct = compileProduct({
    name: "fixture",
    commands,
    handlers: bindHandlers(commands)({ "document.read": () => ({ message: "雪" }) }),
  });
  const bounded = await runNodeCli(successProduct, ["read"], { maxOutputBytes: 1 });
  assert.equal(bounded.exitCode, 1);
  assert.equal(bounded.failureKind, "budget");
  assert.equal(bounded.stdout, "");
  assert.equal(Buffer.byteLength(bounded.stderr, "utf8"), 0);

  const defectProduct = compileProduct({
    name: "fixture",
    commands,
    handlers: bindHandlers(commands)({ "document.read": () => { throw new Error("defect"); } }),
  });
  const defect = await runNodeCli(defectProduct, ["read"]);
  assert.equal(defect.exitCode, 1);
  assert.equal(defect.failureKind, "unexpected");
  assert.match(defect.stderr, /UNEXPECTED: defect/);
});
