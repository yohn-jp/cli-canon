import assert from "node:assert/strict";
import * as z from "zod";
import {
  bindHandlers,
  compileProduct,
  composeCommandSources,
  defineCommands,
  defineGroups,
  positional,
  projectComposedCommandTree,
  projectHelpDocument,
  textOutput,
} from "@yohn-jp/cli-canon";
import { executeNodeCli, runNodeCli } from "@yohn-jp/cli-canon/node";

// Generic structural case: one declared group has Canon and delegated children.
// These expectations are authored here and do not call a renderer or projector.
const rootHelp =\n  "Usage: atelier <command>\n\nManage the asset workspace.\n\nCommands:\n  assets\tManage assets.\n\nHelp: --help[=full|json]\n";
const groupHelp =
  "Usage: atelier assets <command>\n\nManage assets.\n\nCommands:\n  inspect\tInspect an asset.\n  sync\tSync an asset.\n\nHelp: --help[=full|json]\n";
const commandHelp = "Usage: atelier assets inspect <name>\n\nInspect an asset.\n\nHelp: --help[=full|json]\n";
const commandFullHelp =
  "Usage: atelier assets inspect <name>\n\nInspect an asset.\n\n" +
  "Read one named asset from the domain boundary.\n\nArguments:\n  <name>\tAsset name.\n\n" +
  "Examples:\n  atelier assets inspect sample\n\nHelp: --help[=full|json]\n";

export async function certifyComposition() {
  const calls = { canonical: 0, delegated: 0 };
  const commands = defineCommands({
    "assets.inspect": {
      route: ["assets", "inspect"],
      summary: "Inspect an asset.",
      description: "Read one named asset from the domain boundary.",
      examples: ["atelier assets inspect sample"],
      input: { name: positional(z.string(), { description: "Asset name." }) },
      result: z.object({ name: z.string() }),
    },
  });
  const groups = defineGroups({ assets: { route: ["assets"], summary: "Manage assets." } });
  const product = compileProduct({
    name: "atelier",
    description: "Manage the asset workspace.",
    groups,
    commands,
    handlers: bindHandlers(commands)({
      "assets.inspect": ({ name }) => {
        calls.canonical += 1;
        return { name };
      },
    }),
  });
  assert.equal(product.tree.kind, "root");
  assert.equal(product.tree.children[0].kind, "group");
  assert.equal(product.tree.children[0].children[0].id, "assets.inspect");
  assert.ok(Object.isFrozen(product.tree.children[0].children));

  const resultPresenter = { success: ({ result }) => textOutput(`asset: ${result.name}\n`) };
  const pure = await executeNodeCli(product, ["assets", "inspect", "sample"]);
  assert.deepEqual(pure, { status: "success", commandId: "assets.inspect", result: { name: "sample" } });
  assert.deepEqual(await runNodeCli(product, ["assets", "inspect", "sample"], { resultPresenter }), {
    exitCode: 0,
    stdout: "asset: sample\n",
    stderr: "",
  });
  assert.equal(calls.canonical, 2);

  const delegated = {
    kind: "delegated",
    id: "external",
    commands: [{ id: "assets.sync", route: ["assets", "sync"], summary: "Sync an asset.", fields: [] }],
    execute: async () => {
      calls.delegated += 1;
      return { exitCode: 7, stdout: "", stderr: "domain sync failed\n" };
    },
  };
  const tree = composeCommandSources([{ kind: "canonical", id: "atelier", product }, delegated]);
  const group = tree.root.children[0];
  assert.equal(group.kind, "group");
  assert.deepEqual(
    group.children.map(({ id, owner }) => [id, owner.sourceId]),
    [
      ["assets.inspect", "atelier"],
      ["assets.sync", "external"],
    ],
  );
  const projection = projectComposedCommandTree(tree, {
    name: "atelier",
    description: product.description,
  });
  assert.equal(
    projectHelpDocument(projection, { kind: "root" })?.summary,
    "Manage the asset workspace.",
  );
  assert.deepEqual(
    projectHelpDocument(projection, { kind: "group", id: "assets", route: ["assets"] })?.children.map(({ id }) => id),
    ["assets.inspect", "assets.sync"],
  );

  const options = { delegatedSources: [delegated], resultPresenter };
  for (const [argv, expected] of [
    [["--help"], rootHelp],
    [["--help=full"], rootHelp],
    [["assets", "--help"], groupHelp],
    [["assets", "inspect", "--help"], commandHelp],
    [["assets", "inspect", "--help=full"], commandFullHelp],
  ]) {
    assert.deepEqual(await runNodeCli(product, argv, options), { exitCode: 0, stdout: expected, stderr: "" });
  }
  const commandFacts = [
    { id: "assets.inspect", route: ["assets", "inspect"], summary: "Inspect an asset." },
    { id: "assets.sync", route: ["assets", "sync"], summary: "Sync an asset." },
  ];
  for (const [argv, expected] of [
    [["--help=json"], commandFacts],
    [["assets", "--help=json"], commandFacts],
    [["assets", "inspect", "--help=json"], [commandFacts[0]]],
  ]) {
    const outcome = await runNodeCli(product, argv, options);
    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.stderr, "");
    assert.ok(outcome.stdout.endsWith("\n"));
    const discovery = JSON.parse(outcome.stdout);
    assert.equal(discovery.name, "atelier");
    assert.equal(discovery.description, "Manage the asset workspace.");
    assert.deepEqual(
      discovery.commands.map(({ id, route, summary }) => ({ id, route, summary })),
      expected,
    );
  }
  assert.equal(calls.delegated, 0, "help and discovery must not execute the delegated runtime");
  assert.equal(calls.canonical, 2, "help and discovery must not execute Canon handlers");

  const failures = [
    {
      argv: ["assets", "inspect", "--bogus"],
      code: "unknown-option",
      message: "unknown option",
      usage: "atelier assets inspect <name>",
    },
    {
      argv: ["assets", "inspect"],
      code: "missing-positional-argument",
      message: "required argument missing",
      usage: "atelier assets inspect <name>",
    },
    { argv: ["assets"], code: "no-command", message: "no command selected", usage: "atelier assets <command>" },
    {
      argv: ["assets", "absent"],
      code: "unknown-command",
      message: "unknown command",
      usage: "atelier assets <command>",
    },
  ];
  for (const { argv, code, message, usage } of failures) {
    const semantic = await executeNodeCli(product, argv, options);
    assert.equal(semantic.status, "failure");
    assert.equal(semantic.failureKind, "usage");
    assert.equal(semantic.usageFailure.code, code);
    assert.deepEqual(await runNodeCli(product, argv, options), {
      exitCode: 2,
      stdout: "",
      stderr: `error: ${message}\n\nUsage: ${usage}\n`,
      failureKind: "usage",
    });
  }
  assert.equal(calls.delegated, 0, "usage failures must not probe delegated execution");
  assert.equal(calls.canonical, 2);

  assert.deepEqual(await runNodeCli(product, ["assets", "sync"], options), {
    exitCode: 7,
    stdout: "",
    stderr: "domain sync failed\n",
  });
  assert.equal(calls.delegated, 1);
  assert.equal(calls.canonical, 2, "delegated ownership must be resolved before Canon dispatch");
}
