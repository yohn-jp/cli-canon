import assert from "node:assert/strict";
import test from "node:test";
import * as z from "zod";
import {
  bindHandlers,
  compileProduct,
  composeCommandProjection,
  defineCommands,
  defineGroups,
  flag,
  option,
  parseHelpMode,
  positional,
  projectDiscovery,
  projectHelp,
  projectHelpDocument,
  rawArgs,
  renderHelp,
  resolveHelpTarget,
} from "../../dist/index.js";
import { runNodeCli } from "../../dist/node/index.js";

// Expected documents below are written by hand; they are never produced by the projector under test.

function kit() {
  const commands = defineCommands({
    "document.render": {
      route: ["document", "render"],
      summary: "Render a document.",
      description: "Render one input file to the requested path.",
      examples: ["kit document render in.md -o out.html"],
      input: {
        file: positional(z.string(), { metavar: "file", description: "Input file." }),
        out: option("--out", z.string(), { aliases: ["-o"], required: true, metavar: "path", description: "Output." }),
        draft: flag("--draft", { aliases: ["-d"], description: "Render a draft." }),
        tag: option("--tag", z.string(), { repeatable: true }),
        level: option("--level", z.string(), { valueArity: "optional" }),
        args: rawArgs(),
      },
      result: z.object({}),
    },
    "document.internal.audit": {
      route: ["document", "internal", "audit"],
      summary: "Audit document internals.",
      input: { scope: positional(z.string(), { required: false }) },
      result: z.object({}),
    },
    "math.double": {
      route: ["math", "double"],
      summary: "Double an integer.",
      input: { value: positional(z.coerce.number().int()) },
      result: z.object({}),
    },
  });
  const groups = defineGroups({
    document: {
      route: ["document"],
      summary: "Work with documents.",
      description: "Document commands operate on local files.",
      examples: ["kit document render in.md -o out.html"],
    },
    "document.internal": { route: ["document", "internal"], summary: "Internal document tools." },
  });
  const handlers = bindHandlers(commands)({
    "document.render": () => ({}),
    "document.internal.audit": () => ({}),
    "math.double": () => ({}),
  });
  return compileProduct({ name: "kit", description: "Canonical document toolkit.", commands, handlers, groups });
}

const renderCommandIds = ["document.internal.audit", "document.render"];

test("root help document lists canonical tree children without inferring undeclared groups", () => {
  const root = projectHelpDocument(kit(), { kind: "root" });
  assert.deepEqual(
    { ...root, commands: root.commands.map(({ id }) => id) },
    {
      mode: "summary",
      productName: "kit",
      target: { kind: "root" },
      usage: ["kit", "<command>"],
      summary: "Canonical document toolkit.",
      arguments: [],
      options: [],
      children: [
        { kind: "group", id: "document", route: ["document"], name: "document", summary: "Work with documents." },
        {
          kind: "command",
          id: "math.double",
          route: ["math", "double"],
          name: "math double",
          summary: "Double an integer.",
        },
      ],
      examples: [],
      commands: ["document.internal.audit", "document.render", "math.double"],
    },
  );
  assert.equal(resolveHelpTarget(kit(), ["math"]), undefined);
  assert.deepEqual(parseHelpMode(kit(), ["math", "--help"])?.request, { kind: "root", mode: "text" });
});

test("nested group help document derives content from the group declaration", () => {
  const product = kit();
  assert.deepEqual(resolveHelpTarget(product, ["document"]), { kind: "group", id: "document", route: ["document"] });
  const full = projectHelpDocument(product, { kind: "group", id: "document", route: ["document"] }, "full");
  assert.deepEqual(
    { ...full, commands: full.commands.map(({ id }) => id) },
    {
      mode: "full",
      productName: "kit",
      target: { kind: "group", id: "document", route: ["document"] },
      usage: ["kit", "document", "<command>"],
      summary: "Work with documents.",
      description: "Document commands operate on local files.",
      arguments: [],
      options: [],
      children: [
        {
          kind: "group",
          id: "document.internal",
          route: ["document", "internal"],
          name: "internal",
          summary: "Internal document tools.",
        },
        {
          kind: "command",
          id: "document.render",
          route: ["document", "render"],
          name: "render",
          summary: "Render a document.",
          description: "Render one input file to the requested path.",
        },
      ],
      examples: ["kit document render in.md -o out.html"],
      commands: renderCommandIds,
    },
  );

  assert.equal(
    renderHelp(product, { kind: "route", route: ["document", "internal"] }),
    "Usage: kit document internal <command>\n\nInternal document tools.\n\nCommands:\n  audit\tAudit document internals.\n\nHelp: --help[=full|json]\n",
  );
  assert.deepEqual(parseHelpMode(product, ["document", "internal", "--help=full"])?.request, {
    kind: "route",
    route: ["document", "internal"],
    mode: "full",
  });
});

test("leaf command help document derives usage, arguments, options, and examples from grammar", () => {
  const document = projectHelpDocument(
    kit(),
    { kind: "command", id: "document.render", route: ["document", "render"] },
    "full",
  );
  assert.deepEqual(document.usage, [
    "kit",
    "document",
    "render",
    "<file>",
    "-o, --out <path>",
    "[-d, --draft]",
    "[--tag <tag>...]",
    "[--level[=<level>]]",
    "[-- <args...>]",
  ]);
  assert.deepEqual(document.arguments, [
    { key: "file", kind: "positional", label: "<file>", description: "Input file." },
    { key: "args", kind: "raw-args", label: "[-- <args...>]" },
  ]);
  assert.deepEqual(document.options, [
    { key: "out", kind: "option", label: "-o, --out <path>", description: "Output." },
    { key: "draft", kind: "flag", label: "-d, --draft", description: "Render a draft." },
    { key: "tag", kind: "option", label: "[--tag <tag>...]" },
    { key: "level", kind: "option", label: "[--level[=<level>]]" },
  ]);
  assert.deepEqual(document.children, []);
  assert.deepEqual(document.examples, ["kit document render in.md -o out.html"]);
  assert.deepEqual(
    projectHelpDocument(kit(), {
      kind: "command",
      id: "document.internal.audit",
      route: ["document", "internal", "audit"],
    }).usage,
    ["kit", "document", "internal", "audit", "[<scope>]"],
  );
});

test("summary mode omits full-only content while full mode renders it", async () => {
  const product = kit();
  assert.equal(
    (await runNodeCli(product, ["--help"])).stdout,
    "Usage: kit <command>\n\nCanonical document toolkit.\n\nCommands:\n  document\tWork with documents.\n  math double\tDouble an integer.\n\nHelp: --help[=full|json]\n",
  );
  assert.equal(
    (await runNodeCli(product, ["--help=full"])).stdout,
    "Usage: kit <command>\n\nCanonical document toolkit.\n\nCommands:\n  document\tWork with documents.\n" +
      "    Document commands operate on local files.\n  math double\tDouble an integer.\n\nHelp: --help[=full|json]\n",
  );
  const target = { kind: "command", id: "document.render", route: ["document", "render"] };
  const summary = projectHelpDocument(product, target, "summary");
  assert.equal(summary.description, undefined);
  assert.deepEqual([summary.arguments, summary.options, summary.examples], [[], [], []]);

  const usage =
    "Usage: kit document render <file> -o, --out <path> [-d, --draft] [--tag <tag>...] [--level[=<level>]] [-- <args...>]";
  assert.equal(
    (await runNodeCli(product, ["document", "render", "--help"])).stdout,
    `${usage}\n\nRender a document.\n\nHelp: --help[=full|json]\n`,
  );
  assert.equal(
    (await runNodeCli(product, ["document", "render", "--help=full"])).stdout,
    `${usage}\n\nRender a document.\n\nRender one input file to the requested path.\n\n` +
      "Arguments:\n  <file>\tInput file.\n  [-- <args...>]\n" +
      "Options:\n  -o, --out <path>\tOutput.\n  -d, --draft\tRender a draft.\n  [--tag <tag>...]\n  [--level[=<level>]]\n\n" +
      "Examples:\n  kit document render in.md -o out.html\n\nHelp: --help[=full|json]\n",
  );
  assert.equal(
    (await runNodeCli(product, ["document", "--help"])).stdout,
    "Usage: kit document <command>\n\nWork with documents.\n\nCommands:\n  internal\tInternal document tools.\n  render\tRender a document.\n\nHelp: --help[=full|json]\n",
  );
  assert.equal(
    (await runNodeCli(product, ["document", "--help=full"])).stdout,
    "Usage: kit document <command>\n\nWork with documents.\n\nDocument commands operate on local files.\n\n" +
      "Commands:\n  internal\tInternal document tools.\n  render\tRender a document.\n    Render one input file to the requested path.\n\n" +
      "Examples:\n  kit document render in.md -o out.html\n\nHelp: --help[=full|json]\n",
  );
});

test("JSON help is the discovery projection of the same help document", async () => {
  const product = kit();
  const parsed = parseHelpMode(product, ["document", "--help=json"]);
  const json = projectHelp(product, parsed);
  assert.deepEqual(
    json.commands.map(({ id }) => id),
    renderCommandIds,
  );
  assert.deepEqual(json, projectDiscovery(product, { route: ["document"] }));
  const output = await runNodeCli(product, ["document", "internal", "audit", "--help=json"]);
  assert.deepEqual(JSON.parse(output.stdout), {
    name: "kit",
    description: "Canonical document toolkit.",
    commands: [
      {
        id: "document.internal.audit",
        route: ["document", "internal", "audit"],
        summary: "Audit document internals.",
        fields: [{ key: "scope", kind: "positional", required: false }],
      },
    ],
  });
});

test("human and JSON help preserve Unicode, final newlines, and complete output budgets", async () => {
  const commands = defineCommands({
    snow: {
      route: ["snow"],
      summary: "雪を描く。",
      input: { value: positional(z.string(), { metavar: "値" }) },
      result: z.object({}),
    },
  });
  const product = compileProduct({ name: "cli", commands, handlers: bindHandlers(commands)({ snow: () => ({}) }) });
  const expectedHelp = "Usage: cli <command>\n\nCommands:\n  snow\t雪を描く。\n\nHelp: --help[=full|json]\n";
  const helpBytes = Buffer.byteLength(expectedHelp, "utf8");
  const help = await runNodeCli(product, ["--help"], { maxOutputBytes: helpBytes });
  assert.deepEqual(help, { exitCode: 0, stdout: expectedHelp, stderr: "" });
  assert.equal(help.stdout.endsWith("\n"), true);
  assert.equal(Buffer.byteLength(help.stdout, "utf8"), helpBytes);

  const boundedHelp = await runNodeCli(product, ["--help"], { maxOutputBytes: helpBytes - 1 });
  assert.equal(boundedHelp.exitCode, 1);
  assert.equal(boundedHelp.failureKind, "budget");
  assert.equal(boundedHelp.stdout, "");
  assert.ok(Buffer.byteLength(boundedHelp.stderr, "utf8") <= helpBytes - 1);

  const json = await runNodeCli(product, ["--help=json"]);
  assert.equal(json.exitCode, 0);
  assert.equal(json.stdout.endsWith("\n"), true);
  assert.doesNotMatch(json.stdout, /^Usage:/u);
  const jsonBytes = Buffer.byteLength(json.stdout, "utf8");
  const boundedJson = await runNodeCli(product, ["--help=json"], { maxOutputBytes: jsonBytes });
  assert.deepEqual(boundedJson, json);
  assert.doesNotThrow(() => JSON.parse(boundedJson.stdout));

  const truncatedJson = await runNodeCli(product, ["--help=json"], { maxOutputBytes: jsonBytes - 1 });
  assert.equal(truncatedJson.exitCode, 1);
  assert.equal(truncatedJson.failureKind, "budget");
  assert.equal(truncatedJson.stdout, "");
  assert.ok(Buffer.byteLength(truncatedJson.stderr, "utf8") <= jsonBytes - 1);
});

test("legacy descriptors attach under the declared group owning their route prefix", async () => {
  const product = kit();
  const legacyRoutes = [
    { id: "legacy.document.lint", route: ["document", "lint"], summary: "Lint a document.", fields: [] },
    { id: "legacy.status", route: ["status"], summary: "Show status.", fields: [] },
  ];
  const projection = composeCommandProjection(product, legacyRoutes);
  assert.equal(
    renderHelp(projection, { kind: "route", route: ["document"] }),
    "Usage: kit document <command>\n\nWork with documents.\n\nCommands:\n  internal\tInternal document tools.\n  lint\tLint a document.\n  render\tRender a document.\n\nHelp: --help[=full|json]\n",
  );
  assert.equal(
    renderHelp(projection),
    "Usage: kit <command>\n\nCanonical document toolkit.\n\nCommands:\n  document\tWork with documents.\n  math double\tDouble an integer.\n  status\tShow status.\n\nHelp: --help[=full|json]\n",
  );
  const json = await runNodeCli(product, ["document", "--help=json"], { legacyRoutes });
  assert.deepEqual(
    JSON.parse(json.stdout).commands.map(({ id }) => id),
    ["document.internal.audit", "legacy.document.lint", "document.render"],
  );
});
