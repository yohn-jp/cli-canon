import assert from "node:assert/strict";
import test from "node:test";
import * as z from "zod";
import {
  CanonConstructionError,
  bindHandlers,
  compileProduct,
  defineCommands,
  flag,
  option,
  positional,
  projectDiscovery,
  rawArgs,
  renderHelp,
} from "../../dist/index.js";
import { runNodeCli } from "../../dist/node/index.js";

function fixture() {
  const commands = defineCommands({
    "document.render": {
      route: ["document", "render"],
      summary: "Render a document.",
      input: {
        file: positional(z.string().min(1), { metavar: "file" }),
        out: option("--out", z.string().min(1), {
          aliases: ["-o"],
          required: true,
          metavar: "path",
        }),
        json: flag("--json", { placement: "anywhere" }),
        tag: option("--tag", z.string().min(1), { repeatable: true, metavar: "tag" }),
        args: rawArgs(),
      },
      result: z.object({
        file: z.string(),
        writtenFile: z.string(),
        json: z.boolean(),
        tags: z.array(z.string()),
        args: z.array(z.string()),
      }),
    },
    "math.double": {
      route: ["math", "double"],
      summary: "Double an integer.",
      input: { value: positional(z.coerce.number().int()) },
      result: z.object({ value: z.number().int() }),
    },
  });
  const handlers = bindHandlers(commands)({
    "document.render": async ({ file, out, json, tag, args }) => ({
      file,
      writtenFile: out,
      json,
      tags: [...tag],
      args: [...args],
    }),
    "math.double": ({ value }) => ({ value: value * 2 }),
  });
  return compileProduct({ name: "fixture", commands, handlers });
}

test("one command canon drives routing, validation, result validation, and output", async () => {
  const result = await runNodeCli(fixture(), [
    "document",
    "render",
    "input.md",
    "-o",
    "out.html",
    "--tag",
    "a",
    "--tag=b",
    "--",
    "--literal",
    "tail",
  ]);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout), {
    file: "input.md",
    writtenFile: "out.html",
    json: false,
    tags: ["a", "b"],
    args: ["--literal", "tail"],
  });
  assert.equal(result.stderr, "");
});

test("declared anywhere flags work before the nested route", async () => {
  const result = await runNodeCli(fixture(), [
    "--json",
    "document",
    "render",
    "input.md",
    "--out=out.html",
  ]);
  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(result.stdout).json, true);
});

test("zod rejects invalid runtime input before the handler", async () => {
  const result = await runNodeCli(fixture(), ["math", "double", "not-a-number"]);
  assert.equal(result.exitCode, 2);
  assert.equal(result.failureKind, "validation");
  assert.match(result.stderr, /INVALID_INPUT/);
});

test("unknown options, surplus positionals, and missing required option fail closed", async () => {
  for (const argv of [
    ["math", "double", "2", "extra"],
    ["math", "double", "2", "--unknown"],
    ["document", "render", "input.md"],
  ]) {
    const result = await runNodeCli(fixture(), argv);
    assert.notEqual(result.exitCode, 0, argv.join(" "));
    assert.equal(result.failureKind, "usage");
  }
});

test("option-looking tokens are consumed as required option values by the M0 grammar", async () => {
  const result = await runNodeCli(fixture(), [
    "document",
    "render",
    "input.md",
    "--out",
    "--json",
  ]);
  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(result.stdout).writtenFile, "--json");
  assert.equal(JSON.parse(result.stdout).json, false);
});

test("text help and JSON discovery are projections of the compiled product", async () => {
  const product = fixture();
  const help = renderHelp(product);
  assert.match(help, /document render/);
  assert.match(renderHelp(product, { kind: "command", commandId: "document.render" }), /--out/);
  const discovery = projectDiscovery(product);
  assert.equal(
    discovery.commands.find((command) => command.id === "document.render")?.route.join(" "),
    "document render",
  );
  const jsonHelp = await runNodeCli(product, ["--help"], { helpFormat: "json" });
  assert.equal(jsonHelp.exitCode, 0);
  assert.deepEqual(JSON.parse(jsonHelp.stdout), discovery);
});

test("result schema rejects a handler result that violates its declared contract", async () => {
  const commands = defineCommands({
    bad: {
      route: ["bad"],
      summary: "bad",
      input: {},
      result: z.object({ ok: z.literal(true) }),
    },
  });
  const handlers = { bad: () => ({ ok: false }) };
  const product = compileProduct({ name: "fixture", commands, handlers });
  const result = await runNodeCli(product, ["bad"]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.failureKind, "handler-result");
  assert.match(result.stderr, /INVALID_HANDLER_RESULT/);
});

test("compileProduct rejects duplicate routes and conflicting anywhere flags", () => {
  const duplicate = defineCommands({
    one: { route: ["same"], summary: "one", input: {}, result: z.object({}) },
    two: { route: ["same"], summary: "two", input: {}, result: z.object({}) },
  });
  assert.throws(
    () =>
      compileProduct({
        name: "fixture",
        commands: duplicate,
        handlers: { one: () => ({}), two: () => ({}) },
      }),
    (error) =>
      error instanceof CanonConstructionError &&
      error.issues.some((issue) => issue.code === "DUPLICATE_ROUTE"),
  );

  const flags = defineCommands({
    one: {
      route: ["one"],
      summary: "one",
      input: { x: flag("--shared", { placement: "anywhere" }) },
      result: z.object({}),
    },
    two: {
      route: ["two"],
      summary: "two",
      input: { x: option("--shared", z.string(), { placement: "anywhere" }) },
      result: z.object({}),
    },
  });
  assert.throws(
    () =>
      compileProduct({
        name: "fixture",
        commands: flags,
        handlers: { one: () => ({}), two: () => ({}) },
      }),
    (error) =>
      error instanceof CanonConstructionError &&
      error.issues.some((issue) => issue.code === "FLAG_COLLISION"),
  );
});
