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

function helpFixture() {
  const commands = defineCommands({
    "document.inspect": {
      route: ["document", "inspect"],
      summary: "Inspect an input file.",
      description: "Read the file and report the selected detail level.",
      examples: ["fixture document inspect input.txt --format=full"],
      input: {
        file: positional(z.string().min(1), { metavar: "file", description: "Input file." }),
        target: positional(z.string(), { required: false, description: "Optional destination." }),
        format: option("--format", z.enum(["full", "json"]), {
          valueArity: "optional",
          metavar: "style",
          description: "Choose an optional detail level.",
        }),
      },
      result: z.object({ file: z.string(), target: z.string().optional(), format: z.string().optional() }),
    },
    "domain.list": {
      route: ["domain", "list"],
      summary: "List domain records.",
      input: {},
      result: z.object({}),
    },
    "domain.show": {
      route: ["domain", "show"],
      summary: "Show one domain record.",
      input: { id: positional(z.string()) },
      result: z.object({}),
    },
  });
  const handlers = bindHandlers(commands)({
    "document.inspect": ({ file, target, format }) => ({
      file,
      ...(target === undefined ? {} : { target }),
      ...(format === undefined ? {} : { format }),
    }),
    "domain.list": () => ({}),
    "domain.show": () => ({}),
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
  const result = await runNodeCli(fixture(), ["--json", "document", "render", "input.md", "--out=out.html"]);
  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(result.stdout).json, true);
});

test("declared anywhere required-value options work before a nested route", async () => {
  const commands = defineCommands({
    "repository.list": {
      route: ["repository", "list"],
      summary: "List repository records.",
      input: {
        repository: option("--repository", z.string(), { required: true, placement: "anywhere" }),
      },
      result: z.object({ repository: z.string() }),
    },
  });
  const product = compileProduct({
    name: "fixture",
    commands,
    handlers: bindHandlers(commands)({ "repository.list": ({ repository }) => ({ repository }) }),
  });
  for (const argv of [
    ["--repository=owner/project", "repository", "list"],
    ["repository", "list", "--repository", "owner/project"],
  ]) {
    const result = await runNodeCli(product, argv);
    assert.equal(result.exitCode, 0, argv.join(" "));
    assert.deepEqual(JSON.parse(result.stdout), { repository: "owner/project" });
  }
  const missing = await runNodeCli(product, ["repository", "list"]);
  assert.notEqual(missing.exitCode, 0);
  assert.equal(missing.failureKind, "usage");
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
    ["document", "render", "input.md", "--out"],
  ]) {
    const result = await runNodeCli(fixture(), argv);
    assert.notEqual(result.exitCode, 0, argv.join(" "));
    assert.equal(result.failureKind, "usage");
  }
});

test("option-looking tokens are consumed as required option values by the M0 grammar", async () => {
  const result = await runNodeCli(fixture(), ["document", "render", "input.md", "--out", "--json"]);
  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(result.stdout).writtenFile, "--json");
  assert.equal(JSON.parse(result.stdout).json, false);

  const helpAsValue = await runNodeCli(fixture(), ["document", "render", "input.md", "--out", "--help"]);
  assert.equal(helpAsValue.exitCode, 0);
  assert.equal(JSON.parse(helpAsValue.stdout).writtenFile, "--help");
});

test("text help and JSON discovery are projections of the compiled product", async () => {
  const product = fixture();
  const help = renderHelp(product);
  assert.match(help, /document\t/);
  assert.match(renderHelp(product, { kind: "route", route: ["document"] }), /render\t/);
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

test("help and discovery order is deterministic across declaration insertion order", () => {
  const declarations = {
    "zeta.run": {
      route: ["zeta", "run"],
      summary: "Run zeta.",
      input: {},
      result: z.object({}),
    },
    "alpha.show": {
      route: ["alpha", "show"],
      summary: "Show alpha.",
      input: {},
      result: z.object({}),
    },
  };
  const expectedHelp =
    "Usage: fixture <command>\n\nCommands:\n  alpha\tShow alpha.\n  zeta\tRun zeta.\n\nHelp: --help[=full|json]\n";
  const expectedDiscovery = {
    name: "fixture",
    commands: [
      { id: "alpha.show", route: ["alpha", "show"], summary: "Show alpha.", fields: [] },
      { id: "zeta.run", route: ["zeta", "run"], summary: "Run zeta.", fields: [] },
    ],
  };
  for (const commands of [
    defineCommands(declarations),
    defineCommands(Object.fromEntries(Object.entries(declarations).reverse())),
  ]) {
    const product = compileProduct({
      name: "fixture",
      commands,
      handlers: { "alpha.show": () => ({}), "zeta.run": () => ({}) },
    });
    assert.equal(renderHelp(product), expectedHelp);
    assert.deepEqual(projectDiscovery(product), expectedDiscovery);
  }
});

test("optional positional and optional-value option grammar reaches handlers", async () => {
  const product = helpFixture();
  const absent = await runNodeCli(product, ["document", "inspect", "input.txt"]);
  assert.equal(absent.exitCode, 0);
  assert.deepEqual(JSON.parse(absent.stdout), { file: "input.txt" });

  const supplied = await runNodeCli(product, ["document", "inspect", "input.txt", "target.txt", "--format=full"]);
  assert.equal(supplied.exitCode, 0);
  assert.deepEqual(JSON.parse(supplied.stdout), {
    file: "input.txt",
    target: "target.txt",
    format: "full",
  });

  const separated = await runNodeCli(product, ["document", "inspect", "input.txt", "--format", "json"]);
  assert.equal(separated.exitCode, 0);
  assert.deepEqual(JSON.parse(separated.stdout), { file: "input.txt", format: "json" });

  const valueless = await runNodeCli(product, ["document", "inspect", "input.txt", "--format"]);
  assert.equal(valueless.exitCode, 0);
  assert.deepEqual(JSON.parse(valueless.stdout), { file: "input.txt" });
});

test("progressive text, full, and JSON help share command canon metadata", async () => {
  const product = helpFixture();
  assert.equal(
    renderHelp(product),
    "Usage: fixture <command>\n\nCommands:\n  document\tInspect an input file.\n  domain\tList domain records.\n\nHelp: --help[=full|json]\n",
  );
  assert.equal(
    renderHelp(product, { kind: "route", route: ["domain"] }),
    "Usage: fixture domain <command>\n\nCommands:\n  list\tList domain records.\n  show\tShow one domain record.\n\nHelp: --help[=full|json]\n",
  );
  assert.equal(
    renderHelp(product, { kind: "command", commandId: "document.inspect", mode: "full" }),
    "Usage: fixture document inspect <file> [<target>] [--format[=<style>]]\n\nInspect an input file.\n\nRead the file and report the selected detail level.\n\nArguments:\n  <file>\tInput file.\n  [<target>]\tOptional destination.\nOptions:\n  [--format[=<style>]]\tChoose an optional detail level.\n\nExamples:\n  fixture document inspect input.txt --format=full\n\nHelp: --help[=full|json]\n",
  );

  const full = await runNodeCli(product, ["document", "inspect", "--help=full"]);
  assert.equal(full.exitCode, 0);
  assert.match(full.stdout, /Optional destination\./);
  assert.match(full.stdout, /fixture document inspect input\.txt --format=full/);

  const json = await runNodeCli(product, ["--help=json", "document", "inspect"]);
  assert.equal(json.exitCode, 0);
  assert.deepEqual(JSON.parse(json.stdout), {
    name: "fixture",
    commands: [
      {
        id: "document.inspect",
        route: ["document", "inspect"],
        summary: "Inspect an input file.",
        description: "Read the file and report the selected detail level.",
        examples: ["fixture document inspect input.txt --format=full"],
        fields: [
          {
            key: "file",
            kind: "positional",
            required: true,
            description: "Input file.",
            metavar: "file",
          },
          {
            key: "target",
            kind: "positional",
            required: false,
            description: "Optional destination.",
          },
          {
            key: "format",
            kind: "option",
            flag: "--format",
            aliases: [],
            placement: "after-route",
            description: "Choose an optional detail level.",
            repeatable: false,
            required: false,
            valueArity: "optional",
            optionLookingValuePolicy: "consume",
            metavar: "style",
          },
        ],
      },
    ],
  });

  const domainJson = await runNodeCli(product, ["domain", "--help=json"]);
  assert.deepEqual(
    JSON.parse(domainJson.stdout).commands.map((command) => command.id),
    ["domain.list", "domain.show"],
  );
});

test("architecture example progressive help uses only the Command Canon", async () => {
  const commands = defineCommands({
    "architecture.example": {
      route: ["architecture", "example"],
      summary: "Show an architecture example.",
      description: "Read one example from the canonical architecture.",
      examples: ["fixture architecture example --format=full"],
      input: {
        format: option("--format", z.enum(["full", "json"]), {
          valueArity: "optional",
          description: "Choose the example detail level.",
        }),
      },
      result: z.object({}),
    },
  });
  const product = compileProduct({
    name: "fixture",
    commands,
    handlers: bindHandlers(commands)({ "architecture.example": () => ({}) }),
  });

  assert.equal(
    (await runNodeCli(product, ["--help"])).stdout,
    "Usage: fixture <command>\n\nCommands:\n  architecture\tShow an architecture example.\n\nHelp: --help[=full|json]\n",
  );
  const domainHelp = await runNodeCli(product, ["architecture", "--help=full"]);
  assert.equal(
    domainHelp.stdout,
    "Usage: fixture architecture <command>\n\nCommands:\n  example\tShow an architecture example.\n    Read one example from the canonical architecture.\n\nHelp: --help[=full|json]\n",
  );

  const leafHelp = await runNodeCli(product, ["architecture", "example", "--help=full"]);
  assert.equal(
    leafHelp.stdout,
    "Usage: fixture architecture example [--format[=<format>]]\n\nShow an architecture example.\n\nRead one example from the canonical architecture.\n\nOptions:\n  [--format[=<format>]]\tChoose the example detail level.\n\nExamples:\n  fixture architecture example --format=full\n\nHelp: --help[=full|json]\n",
  );

  const jsonHelp = await runNodeCli(product, ["architecture", "example", "--help=json"]);
  assert.deepEqual(JSON.parse(jsonHelp.stdout), {
    name: "fixture",
    commands: [
      {
        id: "architecture.example",
        route: ["architecture", "example"],
        summary: "Show an architecture example.",
        description: "Read one example from the canonical architecture.",
        examples: ["fixture architecture example --format=full"],
        fields: [
          {
            key: "format",
            kind: "option",
            flag: "--format",
            aliases: [],
            placement: "after-route",
            description: "Choose the example detail level.",
            repeatable: false,
            required: false,
            valueArity: "optional",
            optionLookingValuePolicy: "consume",
          },
        ],
      },
    ],
  });
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
      error instanceof CanonConstructionError && error.issues.some((issue) => issue.code === "DUPLICATE_ROUTE"),
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
    (error) => error instanceof CanonConstructionError && error.issues.some((issue) => issue.code === "FLAG_COLLISION"),
  );
});

test("compileProduct rejects missing and unknown handler bindings at construction", () => {
  const commands = defineCommands({
    run: { route: ["run"], summary: "Run.", input: {}, result: z.object({}) },
  });
  for (const handlers of [{}, { run: () => ({}), unknown: () => ({}) }]) {
    assert.throws(
      () => compileProduct({ name: "fixture", commands, handlers }),
      (error) =>
        error instanceof CanonConstructionError &&
        error.issues.some((issue) => issue.code === "INVALID_HANDLER_BINDING"),
    );
  }
});

test("compiled command definitions and handler bindings snapshot their authoring inputs", async () => {
  const commands = defineCommands({
    echo: {
      route: ["echo"],
      summary: "Echo.",
      input: { value: positional(z.string()) },
      result: z.object({ value: z.string() }),
    },
  });
  let calls = 0;
  const handlers = bindHandlers(commands)({
    echo: ({ value }) => {
      calls += 1;
      return { value };
    },
  });
  const product = compileProduct({ name: "fixture", commands, handlers });
  assert.equal(calls, 0);

  commands.echo.input.value = positional(z.number());
  handlers.echo = () => ({ value: "mutated" });

  const result = await runNodeCli(product, ["echo", "original"]);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout), { value: "original" });
  assert.equal(calls, 1);
  assert.equal(Object.isFrozen(product.commands[0]?.definition), true);
  assert.equal(Object.isFrozen(product.commands[0]?.definition.input), true);
  assert.equal(Object.isFrozen(product.handlers), true);
});

test("unsupported ordered groups and option-looking-value rejection fail during construction", () => {
  const ordered = defineCommands({
    apply: {
      route: ["apply"],
      summary: "Apply ordered changes.",
      input: {
        resource: option("--resource", z.string(), { repeatable: true }),
        mode: option("--mode", z.string(), { repeatable: true }),
      },
      orderedOptionGroups: [["resource", "mode"]],
      result: z.object({}),
    },
  });
  assert.throws(
    () => compileProduct({ name: "fixture", commands: ordered, handlers: { apply: () => ({}) } }),
    (error) =>
      error instanceof CanonConstructionError &&
      error.issues.some((issue) => issue.code === "UNSUPPORTED_GRAMMAR" && issue.fields?.join(",") === "resource,mode"),
  );

  const optionLooking = defineCommands({
    run: {
      route: ["run"],
      summary: "Run with an explicit option value.",
      input: {
        value: option("--value", z.string(), { optionLookingValuePolicy: "reject" }),
      },
      result: z.object({}),
    },
  });
  assert.throws(
    () => compileProduct({ name: "fixture", commands: optionLooking, handlers: { run: () => ({}) } }),
    (error) =>
      error instanceof CanonConstructionError &&
      error.issues.some((issue) => issue.code === "UNSUPPORTED_GRAMMAR" && issue.field === "value"),
  );
});
