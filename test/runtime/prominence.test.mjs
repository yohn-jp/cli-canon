import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as z from "zod";
import {
  CanonConstructionError,
  bindHandlers,
  compileProduct,
  composeCommandSources,
  defineCommands,
  defineGroups,
  defineSkills,
  positional,
  projectComposedCommandTree,
  projectDiscovery,
  projectHelp,
  projectHelpDocument,
  projectSkill,
  renderHelp,
  skillCommand,
  SkillConstructionError,
} from "../../dist/index.js";
import { runNodeCli } from "../../dist/node/index.js";

// Expected outputs below are written by hand; they are never produced by the projector under test.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function declarations(prominence) {
  return {
    "tools.run": {
      route: ["tools", "run"],
      summary: "Run the tool.",
      input: {},
      result: z.object({ ran: z.string() }),
    },
    "tools.repair": {
      route: ["tools", "repair"],
      summary: "Repair tool state.",
      description: "Rebuild tool state from scratch.",
      ...(prominence === undefined ? {} : { prominence }),
      input: { target: positional(z.string()) },
      result: z.object({ ran: z.string() }),
    },
    status: {
      route: ["status"],
      summary: "Show status.",
      input: {},
      result: z.object({ ran: z.string() }),
    },
    reindex: {
      route: ["reindex"],
      summary: "Rebuild every index.",
      ...(prominence === undefined ? {} : { prominence }),
      input: {},
      result: z.object({ ran: z.string() }),
    },
  };
}

function product(prominence, skills) {
  const commands = defineCommands(declarations(prominence));
  return compileProduct({
    name: "kit",
    commands,
    groups: defineGroups({ tools: { route: ["tools"], summary: "Tool commands." } }),
    handlers: bindHandlers(commands)({
      "tools.run": () => ({ ran: "run" }),
      "tools.repair": ({ target }) => ({ ran: `repair ${target}` }),
      status: () => ({ ran: "status" }),
      reindex: () => ({ ran: "reindex" }),
    }),
    ...(skills === undefined ? {} : { skills: skills(commands) }),
  });
}

const primaryRootHelp =
  "Usage: kit <command>\n\nCommands:\n  status\tShow status.\n  tools\tTool commands.\n\nHelp: --help[=full|json]\n";
const fullRootHelp =
  "Usage: kit <command>\n\nCommands:\n  reindex\tRebuild every index.\n  status\tShow status.\n  tools\tTool commands.\n\nHelp: --help[=full|json]\n";

test("omitted prominence resolves to primary and preserves existing help output", async () => {
  const omitted = product(undefined);
  const primary = product("primary");
  assert.deepEqual(
    omitted.commands.map(({ id, prominence }) => [id, prominence]),
    [
      ["reindex", "primary"],
      ["status", "primary"],
      ["tools.repair", "primary"],
      ["tools.run", "primary"],
    ],
  );
  assert.equal(Object.hasOwn(omitted.commands[2].definition, "prominence"), false);
  assert.equal(renderHelp(omitted), fullRootHelp);
  assert.equal(
    renderHelp(omitted, { kind: "route", route: ["tools"] }),
    "Usage: kit tools <command>\n\nTool commands.\n\nCommands:\n  repair\tRepair tool state.\n  run\tRun the tool.\n\nHelp: --help[=full|json]\n",
  );
  for (const request of [
    { kind: "root" },
    { kind: "root", mode: "full" },
    { kind: "route", route: ["tools"] },
    { kind: "route", route: ["tools"], mode: "full" },
    { kind: "command", commandId: "tools.repair", mode: "full" },
  ]) {
    assert.equal(renderHelp(primary, request), renderHelp(omitted, request));
  }
  assert.deepEqual(projectDiscovery(primary), projectDiscovery(omitted));
  assert.equal((await runNodeCli(omitted, ["--help"])).stdout, fullRootHelp);
});

test("summary help omits advanced command children while full help includes them", async () => {
  const advanced = product("advanced");
  assert.equal(renderHelp(advanced), primaryRootHelp);
  assert.equal((await runNodeCli(advanced, ["--help"])).stdout, primaryRootHelp);
  assert.equal(
    renderHelp(advanced, { kind: "route", route: ["tools"] }),
    "Usage: kit tools <command>\n\nTool commands.\n\nCommands:\n  run\tRun the tool.\n\nHelp: --help[=full|json]\n",
  );
  assert.equal(
    (await runNodeCli(advanced, ["tools", "--help"])).stdout,
    "Usage: kit tools <command>\n\nTool commands.\n\nCommands:\n  run\tRun the tool.\n\nHelp: --help[=full|json]\n",
  );

  assert.equal(renderHelp(advanced, { kind: "root", mode: "full" }), fullRootHelp);
  assert.equal((await runNodeCli(advanced, ["--help=full"])).stdout, fullRootHelp);
  const fullGroupHelp =
    "Usage: kit tools <command>\n\nTool commands.\n\nCommands:\n  repair\tRepair tool state.\n    Rebuild tool state from scratch.\n  run\tRun the tool.\n\nHelp: --help[=full|json]\n";
  assert.equal(renderHelp(advanced, { kind: "route", route: ["tools"], mode: "full" }), fullGroupHelp);
  assert.equal((await runNodeCli(advanced, ["tools", "--help=full"])).stdout, fullGroupHelp);

  const summaryDocument = projectHelpDocument(advanced, { kind: "root" }, "summary");
  assert.deepEqual(
    summaryDocument.children.map(({ id }) => id),
    ["status", "tools"],
  );
  assert.deepEqual(
    summaryDocument.commands.map(({ id }) => id),
    ["reindex", "status", "tools.repair", "tools.run"],
  );
});

test("explicit help for an advanced public command succeeds", async () => {
  const advanced = product("advanced");
  const summary = "Usage: kit tools repair <target>\n\nRepair tool state.\n\nHelp: --help[=full|json]\n";
  assert.equal(renderHelp(advanced, { kind: "command", commandId: "tools.repair" }), summary);
  assert.equal(renderHelp(advanced, { kind: "route", route: ["tools", "repair"] }), summary);
  assert.deepEqual(await runNodeCli(advanced, ["tools", "repair", "--help"]), {
    exitCode: 0,
    stdout: summary,
    stderr: "",
  });
  assert.equal(
    (await runNodeCli(advanced, ["tools", "repair", "--help=full"])).stdout,
    "Usage: kit tools repair <target>\n\nRepair tool state.\n\nRebuild tool state from scratch.\n\nArguments:\n  <target>\n\nHelp: --help[=full|json]\n",
  );
  assert.equal(
    (await runNodeCli(advanced, ["reindex", "--help"])).stdout,
    "Usage: kit reindex\n\nRebuild every index.\n\nHelp: --help[=full|json]\n",
  );
});

test("advanced public commands execute and remain machine-discoverable with resolved prominence", async () => {
  const advanced = product("advanced");
  assert.deepEqual(await runNodeCli(advanced, ["tools", "repair", "cache"]), {
    exitCode: 0,
    stdout: '{"ran":"repair cache"}\n',
    stderr: "",
  });
  assert.deepEqual(await runNodeCli(advanced, ["reindex"]), {
    exitCode: 0,
    stdout: '{"ran":"reindex"}\n',
    stderr: "",
  });
  assert.deepEqual(
    projectDiscovery(advanced).commands.map(({ id, prominence }) => [id, prominence]),
    [
      ["reindex", "advanced"],
      ["status", "primary"],
      ["tools.repair", "advanced"],
      ["tools.run", "primary"],
    ],
  );
  const json = await runNodeCli(advanced, ["--help=json"]);
  assert.equal(json.exitCode, 0);
  assert.deepEqual(
    JSON.parse(json.stdout).commands.map(({ id, prominence }) => [id, prominence]),
    [
      ["reindex", "advanced"],
      ["status", "primary"],
      ["tools.repair", "advanced"],
      ["tools.run", "primary"],
    ],
  );
  const groupJson = await runNodeCli(advanced, ["tools", "--help=json"]);
  assert.deepEqual(JSON.parse(groupJson.stdout), {
    name: "kit",
    commands: [
      {
        id: "tools.repair",
        route: ["tools", "repair"],
        summary: "Repair tool state.",
        prominence: "advanced",
        description: "Rebuild tool state from scratch.",
        fields: [{ key: "target", kind: "positional", required: true }],
      },
      { id: "tools.run", route: ["tools", "run"], summary: "Run the tool.", prominence: "primary", fields: [] },
    ],
  });
  const parsed = { mode: "json", request: { kind: "command", commandId: "reindex" } };
  assert.deepEqual(projectHelp(advanced, parsed).commands, [
    { id: "reindex", route: ["reindex"], summary: "Rebuild every index.", prominence: "advanced", fields: [] },
  ]);
});

test("public advanced commands remain Skill-addressable; private visibility still gates Skills", () => {
  const withSkill = product("advanced", (commands) =>
    defineSkills({
      maintain: {
        summary: "Maintain the tool.",
        steps: [skillCommand(commands, "tools.repair", { guidance: "Repair.", bindings: { target: "cache" } })],
      },
    }),
  );
  assert.deepEqual(projectSkill(withSkill, "maintain").steps[0].invocation, {
    state: "ready",
    commandId: "tools.repair",
    value: { executable: "kit", argv: ["tools", "repair", "cache"] },
  });

  const commands = defineCommands({
    hidden: {
      route: ["hidden"],
      summary: "Hidden.",
      visibility: "private",
      prominence: "primary",
      input: {},
      result: z.object({}),
    },
  });
  assert.throws(
    () =>
      compileProduct({
        name: "kit",
        commands,
        handlers: bindHandlers(commands)({ hidden: () => ({}) }),
        skills: defineSkills({
          leak: { summary: "Leak.", steps: [skillCommand(commands, "hidden", { guidance: "No." })] },
        }),
      }),
    (error) =>
      error instanceof SkillConstructionError &&
      error.issues.some((issue) => issue.code === "PRIVATE_COMMAND_REFERENCE"),
  );
});

test("invalid runtime prominence declarations fail at construction", () => {
  const commands = defineCommands({
    odd: { route: ["odd"], summary: "Odd.", prominence: "specialized", input: {}, result: z.object({}) },
  });
  assert.throws(
    () => compileProduct({ name: "kit", commands, handlers: bindHandlers(commands)({ odd: () => ({}) }) }),
    (error) =>
      error instanceof CanonConstructionError &&
      error.issues.some(
        (issue) => issue.commandId === "odd" && /prominence must be primary or advanced/u.test(issue.message),
      ),
  );
  assert.throws(
    () =>
      composeCommandSources([
        {
          kind: "delegated",
          id: "external",
          commands: [{ id: "x", route: ["x"], summary: "X.", prominence: "hidden", fields: [] }],
        },
      ]),
    (error) =>
      error instanceof CanonConstructionError &&
      error.issues.some((issue) => issue.code === "INVALID_COMMAND_SOURCE" && issue.commandId === "x"),
  );
});

test("canonical and delegated composed projections carry one resolved prominence", async () => {
  const advanced = product("advanced");
  const delegated = {
    kind: "delegated",
    id: "external",
    commands: [
      { id: "external.sync", route: ["tools", "sync"], summary: "Sync tools.", prominence: "advanced", fields: [] },
      { id: "external.check", route: ["tools", "check"], summary: "Check tools.", fields: [] },
    ],
  };
  const tree = composeCommandSources([{ kind: "canonical", id: "canon", product: advanced }, delegated]);
  const reversed = composeCommandSources([delegated, { kind: "canonical", id: "canon", product: advanced }]);
  const tools = tree.root.children.find((node) => node.id === "tools");
  assert.deepEqual(
    tools.children.map(({ id, owner, prominence }) => [id, owner.sourceId, prominence]),
    [
      ["external.check", "external", "primary"],
      ["tools.repair", "canon", "advanced"],
      ["tools.run", "canon", "primary"],
      ["external.sync", "external", "advanced"],
    ],
  );
  assert.equal(Object.hasOwn(tools, "prominence"), false);
  const projection = projectComposedCommandTree(tree, { name: "kit" });
  assert.deepEqual(projectComposedCommandTree(reversed, { name: "kit" }), projection);
  assert.equal(
    renderHelp(projection, { kind: "route", route: ["tools"] }),
    "Usage: kit tools <command>\n\nTool commands.\n\nCommands:\n  check\tCheck tools.\n  run\tRun the tool.\n\nHelp: --help[=full|json]\n",
  );
  assert.equal(
    renderHelp(projection, { kind: "route", route: ["tools"], mode: "full" }),
    "Usage: kit tools <command>\n\nTool commands.\n\nCommands:\n  check\tCheck tools.\n  repair\tRepair tool state.\n    Rebuild tool state from scratch.\n  run\tRun the tool.\n  sync\tSync tools.\n\nHelp: --help[=full|json]\n",
  );
  assert.deepEqual(
    projectDiscovery(projection).commands.map(({ id, prominence }) => [id, prominence]),
    [
      ["reindex", "advanced"],
      ["status", "primary"],
      ["external.check", "primary"],
      ["tools.repair", "advanced"],
      ["tools.run", "primary"],
      ["external.sync", "advanced"],
    ],
  );

  const executorCalls = [];
  const executable = {
    ...delegated,
    execute: (request) => {
      executorCalls.push(request.commandId);
      return { exitCode: 0, stdout: "synced\n", stderr: "" };
    },
  };
  const options = { delegatedSources: [executable] };
  assert.equal(
    (await runNodeCli(advanced, ["tools", "--help"], options)).stdout,
    "Usage: kit tools <command>\n\nTool commands.\n\nCommands:\n  check\tCheck tools.\n  run\tRun the tool.\n\nHelp: --help[=full|json]\n",
  );
  assert.equal(
    (await runNodeCli(advanced, ["tools", "sync", "--help"], options)).stdout,
    "Usage: kit tools sync\n\nSync tools.\n\nHelp: --help[=full|json]\n",
  );
  assert.deepEqual(
    JSON.parse((await runNodeCli(advanced, ["tools", "--help=json"], options)).stdout).commands.map(
      ({ id, prominence }) => [id, prominence],
    ),
    [
      ["external.check", "primary"],
      ["tools.repair", "advanced"],
      ["tools.run", "primary"],
      ["external.sync", "advanced"],
    ],
  );
  assert.deepEqual(await runNodeCli(advanced, ["tools", "sync"], options), {
    exitCode: 0,
    stdout: "synced\n",
    stderr: "",
  });
  assert.deepEqual(executorCalls, ["external.sync"]);
});

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  return result;
}

const consumerSource = `import * as z from "zod";
import {
  bindHandlers,
  compileProduct,
  composeCommandSources,
  defineCommands,
  defineGroups,
  projectComposedCommandTree,
  projectDiscovery,
  renderHelp,
  type CommandDefinition,
  type CommandDiscovery,
  type CommandProminence,
  type ComposedCommandNode,
  type DelegatedCommandDescriptor,
} from "@yohn-jp/cli-canon";

const commands = defineCommands({
  "tools.run": { route: ["tools", "run"], summary: "Run.", input: {}, result: z.object({}) },
  "tools.repair": { route: ["tools", "repair"], summary: "Repair.", prominence: "advanced", input: {}, result: z.object({}) },
});
const product = compileProduct({
  name: "packed",
  commands,
  groups: defineGroups({ tools: { route: ["tools"], summary: "Tools." } }),
  handlers: bindHandlers(commands)({ "tools.run": () => ({}), "tools.repair": () => ({}) }),
});
const resolved: CommandProminence = product.commands[0]!.prominence;
void resolved;
const discovered: CommandProminence = projectDiscovery(product).commands[0]!.prominence;
void discovered;
// @ts-expect-error prominence is limited to primary and advanced.
const invalid: CommandProminence = "specialized";
void invalid;
// @ts-expect-error command declarations accept only primary or advanced prominence.
const badDefinition: CommandDefinition = { route: ["x"], summary: "X.", prominence: "hidden", input: {}, result: z.object({}) };
void badDefinition;
const descriptor: DelegatedCommandDescriptor = { id: "d", route: ["tools", "sync"], summary: "Sync.", prominence: "advanced", fields: [] };
const tree = composeCommandSources([
  { kind: "canonical", id: "canon", product },
  { kind: "delegated", id: "external", commands: [descriptor] },
]);
const projection = projectComposedCommandTree(tree, { name: "packed" });
const summary = renderHelp(projection, { kind: "route", route: ["tools"] });
const full = renderHelp(projection, { kind: "route", route: ["tools"], mode: "full" });
if (summary.includes("repair") || summary.includes("sync") || !summary.includes("run")) {
  throw new Error("summary help must list only primary commands: " + summary);
}
if (!full.includes("repair") || !full.includes("sync")) throw new Error("full help must list advanced commands");
const discovery: readonly CommandDiscovery[] = projectDiscovery(projection).commands;
if (discovery.map(({ id, prominence }) => id + ":" + prominence).join(",") !== "tools.repair:advanced,tools.run:primary,d:advanced") {
  throw new Error("discovery must retain advanced commands with resolved prominence");
}
function commandNodes(tree: typeof projection): readonly ComposedCommandNode[] {
  return tree.commands as readonly ComposedCommandNode[];
}
if (commandNodes(projection).some((node) => node.prominence !== "primary" && node.prominence !== "advanced")) {
  throw new Error("composed nodes carry resolved prominence");
}
`;

test("packed public consumer declares and projects command prominence", () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "cli-canon-prominence-"));
  try {
    const packDir = path.join(workspace, "pack");
    const consumer = path.join(workspace, "consumer");
    mkdirSync(packDir);
    // `pnpm test` builds dist first; skip prepack so parallel runtime tests never observe a rebuild.
    run("pnpm", ["--config.ignore-scripts=true", "pack", "--pack-destination", packDir], { cwd: root });
    const archives = readdirSync(packDir).filter((file) => file.endsWith(".tgz"));
    assert.equal(archives.length, 1);
    const installed = path.join(consumer, "node_modules", "@yohn-jp", "cli-canon");
    mkdirSync(installed, { recursive: true });
    run("tar", ["-xzf", path.join(packDir, archives[0]), "-C", installed, "--strip-components=1"]);
    for (const dependency of ["zod", "commander"]) {
      symlinkSync(path.join(root, "node_modules", dependency), path.join(consumer, "node_modules", dependency), "dir");
    }
    writeFileSync(path.join(consumer, "package.json"), JSON.stringify({ type: "module", private: true }));
    writeFileSync(
      path.join(consumer, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          exactOptionalPropertyTypes: true,
          noUncheckedIndexedAccess: true,
          skipLibCheck: false,
          outDir: "out",
        },
        include: ["consumer.ts"],
      }),
    );
    writeFileSync(path.join(consumer, "consumer.ts"), consumerSource);
    run(process.execPath, [path.join(root, "node_modules", "typescript", "bin", "tsc"), "-p", consumer]);
    run(process.execPath, [path.join(consumer, "out", "consumer.js")], { cwd: consumer });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
