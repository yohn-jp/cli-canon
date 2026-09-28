import assert from "node:assert/strict";
import test from "node:test";
import * as z from "zod";
import {
  CanonConstructionError,
  bindHandlers,
  compileProduct,
  composeCommandSources,
  defineCommands,
  defineGroups,
  executeComposedArgv,
  flag,
  option,
  positional,
} from "../../dist/index.js";
import { executeNodeCli, runNodeCli } from "../../dist/node/index.js";

const packageMetadata = { name: "@example/atelier", version: "2.0.0", bin: { atelier: "./dist/cli.js" } };

/**
 * Canonical `assets inspect` and delegated `assets sync` are siblings in one group. Both
 * declare an `anywhere` `--verbose` flag; only the canonical command declares `--scope`,
 * and only the delegated command declares `--profile` and a repeatable `--tag`.
 */
function fixture() {
  const calls = [];
  const commands = defineCommands({
    "assets.inspect": {
      route: ["assets", "inspect"],
      summary: "Inspect an asset.",
      input: {
        name: positional(z.string()),
        verbose: flag("--verbose", { placement: "anywhere" }),
        scope: option("--scope", z.string(), { placement: "anywhere" }),
      },
      result: z.object({ name: z.string(), verbose: z.boolean(), scope: z.string().optional() }),
    },
  });
  const product = compileProduct({
    name: "atelier",
    commands,
    groups: defineGroups({ assets: { route: ["assets"], summary: "Manage assets." } }),
    handlers: bindHandlers(commands)({
      "assets.inspect": ({ name, verbose, scope }) => {
        calls.push(["assets.inspect", name, verbose, scope]);
        return { name, verbose, ...(scope === undefined ? {} : { scope }) };
      },
    }),
    packageMetadata,
  });
  const executorCalls = [];
  const delegated = {
    kind: "delegated",
    id: "external",
    commands: [
      {
        id: "assets.sync",
        route: ["assets", "sync"],
        summary: "Sync an asset.",
        fields: [
          { key: "verbose", kind: "flag", flag: "--verbose", aliases: [], placement: "anywhere" },
          {
            key: "profile",
            kind: "option",
            flag: "--profile",
            aliases: ["-p"],
            repeatable: false,
            required: false,
            valueArity: "required",
            optionLookingValuePolicy: "consume",
            placement: "anywhere",
          },
          {
            key: "tag",
            kind: "option",
            flag: "--tag",
            aliases: [],
            repeatable: true,
            required: false,
            valueArity: "required",
            optionLookingValuePolicy: "consume",
            placement: "anywhere",
          },
          { key: "name", kind: "positional", required: false },
        ],
      },
    ],
    execute: (request) => {
      executorCalls.push(request);
      return { exitCode: 0, stdout: `${request.presentation} ${request.argv.join(" ")}\n`, stderr: "" };
    },
  };
  return { product, calls, delegated, executorCalls, options: { delegatedSources: [delegated] } };
}

async function delegatedArgv(argv) {
  const { product, calls, executorCalls, options } = fixture();
  const outcome = await executeNodeCli(product, argv, options);
  assert.equal(outcome.status, "delegated", JSON.stringify(outcome));
  assert.equal(executorCalls.length, 1, "the delegated executor runs exactly once");
  assert.deepEqual(calls, [], "a delegated route never runs a Canon handler");
  const [request] = executorCalls;
  assert.equal(request.sourceId, "external");
  assert.equal(request.commandId, "assets.sync");
  assert.deepEqual(request.route, ["assets", "sync"]);
  assert.ok(Object.isFrozen(request.argv));
  return request.argv;
}

test("a delegated anywhere option before the route reaches the delegated executor", async () => {
  assert.deepEqual(await delegatedArgv(["--profile", "prod", "assets", "sync", "logo"]), ["--profile", "prod", "logo"]);
  assert.deepEqual(await delegatedArgv(["-p", "prod", "assets", "sync"]), ["-p", "prod"]);
  assert.deepEqual(await delegatedArgv(["--profile=prod", "assets", "sync"]), ["--profile=prod"]);
  assert.deepEqual(await delegatedArgv(["--verbose", "assets", "sync"]), ["--verbose"]);
});

test("leading and post-route occurrences produce equivalent delegated input", async () => {
  assert.deepEqual(
    await delegatedArgv(["--profile", "prod", "--verbose", "assets", "sync", "logo"]),
    await delegatedArgv(["assets", "sync", "--profile", "prod", "--verbose", "logo"]),
  );
  assert.deepEqual(await delegatedArgv(["assets", "sync", "--profile", "prod"]), ["--profile", "prod"]);
});

test("repeatable delegated anywhere occurrences before and after the route are each forwarded once in order", async () => {
  assert.deepEqual(await delegatedArgv(["--tag", "a", "--tag=b", "assets", "sync", "--tag", "c", "logo"]), [
    "--tag",
    "a",
    "--tag=b",
    "--tag",
    "c",
    "logo",
  ]);
  assert.deepEqual(await delegatedArgv(["--tag", "a", "assets", "sync", "--tag", "b"]), ["--tag", "a", "--tag", "b"]);
});

test("the option terminator before the route is not forwarded, but a `--` option value is", async () => {
  assert.deepEqual(await delegatedArgv(["--tag", "a", "--", "assets", "sync", "logo"]), ["--tag", "a", "logo"]);
  assert.deepEqual(await delegatedArgv(["--verbose", "--", "assets", "sync"]), ["--verbose"]);
  assert.deepEqual(await delegatedArgv(["--tag", "--", "assets", "sync"]), ["--tag", "--"]);
  assert.deepEqual(await delegatedArgv(["--tag=--", "--", "assets", "sync"]), ["--tag=--"]);
});

test("canonical and delegated siblings with a same-named anywhere field are owned by the resolved route", async () => {
  const { product, calls, executorCalls, options } = fixture();
  assert.deepEqual(
    await executeNodeCli(product, ["--verbose", "--scope", "all", "assets", "inspect", "logo"], options),
    {
      status: "success",
      commandId: "assets.inspect",
      result: { name: "logo", verbose: true, scope: "all" },
      presentation: "human",
    },
  );
  assert.deepEqual(executorCalls, [], "a canonical route never crosses a delegated executor");
  assert.deepEqual(calls, [["assets.inspect", "logo", true, "all"]]);

  assert.deepEqual(await delegatedArgv(["--verbose", "assets", "sync"]), ["--verbose"]);
});

test("a leading occurrence the resolved owner does not declare fails before execution", async () => {
  const { product, calls, executorCalls, options } = fixture();
  for (const [argv, commandId, flagToken, usage] of [
    [["--scope", "all", "assets", "sync"], "assets.sync", "--scope", "atelier assets sync"],
    [["--verbose", "--scope", "all", "assets", "sync"], "assets.sync", "--scope", "atelier assets sync"],
    [["--profile", "prod", "assets", "inspect", "logo"], "assets.inspect", "--profile", "atelier assets inspect"],
    [["--tag", "a", "assets", "inspect", "logo"], "assets.inspect", "--tag", "atelier assets inspect"],
  ]) {
    const outcome = await executeNodeCli(product, argv, options);
    assert.equal(outcome.status, "failure");
    assert.equal(outcome.failureKind, "usage");
    assert.equal(outcome.usageFailure.code, "unknown-option");
    assert.equal(outcome.usageFailure.commandId, commandId);
    assert.equal(outcome.usageFailure.option, flagToken);
    const rendered = await runNodeCli(product, argv, options);
    assert.equal(rendered.exitCode, 2);
    assert.equal(rendered.stdout, "");
    assert.ok(rendered.stderr.startsWith(`error: unknown option\n\nUsage: ${usage}`), rendered.stderr);
  }
  assert.deepEqual(executorCalls, []);
  assert.deepEqual(calls, []);
});

test("Canon shell controls keep precedence over leading delegated fields and are never forwarded", async () => {
  const { product, calls, executorCalls, options } = fixture();
  assert.deepEqual(await runNodeCli(product, ["--json", "--tag", "a", "assets", "sync", "--json"], options), {
    exitCode: 0,
    stdout: "machine --tag a\n",
    stderr: "",
  });
  assert.deepEqual(executorCalls.at(-1).argv, ["--tag", "a"]);

  executorCalls.length = 0;
  for (const argv of [
    ["--tag", "a", "--help", "assets", "sync"],
    ["--tag", "a", "assets", "sync", "-h"],
    ["--profile", "prod", "--help=json", "assets", "sync"],
  ]) {
    const outcome = await executeNodeCli(product, argv, options);
    assert.equal(outcome.status, "help", argv.join(" "));
  }
  const help = await executeNodeCli(product, ["--tag", "a", "assets", "sync", "--help"], options);
  assert.deepEqual(help.request, { kind: "command", commandId: "assets.sync", mode: "text" });
  assert.deepEqual(await runNodeCli(product, ["--json", "--version"], options), {
    exitCode: 0,
    stdout: '{"name":"@example/atelier","version":"2.0.0"}\n',
    stderr: "",
  });
  const version = await executeNodeCli(product, ["--tag", "a", "--version", "assets", "sync"], options);
  assert.equal(version.status, "failure");
  assert.equal(version.usageFailure.code, "unknown-option");
  assert.deepEqual(executorCalls, [], "Help, version, and shell failures never invoke a delegated executor");
  assert.deepEqual(calls, []);
});

test("unknown and incomplete routes with a leading field never reach any source", async () => {
  const { product, calls, executorCalls, options } = fixture();
  for (const [argv, code, usage] of [
    [["--tag", "a", "assets", "absent"], "unknown-command", "atelier assets <command>"],
    [["--profile", "prod", "absent"], "unknown-command", "atelier <command>"],
    [["--tag", "a", "assets"], "no-command", "atelier assets <command>"],
    [["--verbose"], "no-command", "atelier <command>"],
  ]) {
    const outcome = await executeNodeCli(product, argv, options);
    assert.equal(outcome.status, "failure", argv.join(" "));
    assert.equal(outcome.failureKind, "usage");
    assert.equal(outcome.usageFailure.code, code);
    assert.deepEqual(outcome.usage.join(" "), usage);
  }
  const grouped = await executeNodeCli(product, ["assets", "--tag", "a", "sync"], options);
  assert.equal(grouped.status, "failure");
  assert.equal(grouped.usageFailure.code, "unknown-option", "anywhere fields are not admitted between route segments");
  assert.deepEqual(executorCalls, []);
  assert.deepEqual(calls, []);
});

test("conflicting composed anywhere field declarations fail deterministically at construction", async () => {
  const { product, delegated, executorCalls } = fixture();
  const canonical = { kind: "canonical", id: "atelier", product };
  const field = (overrides) => ({
    key: "verbose",
    kind: "option",
    flag: "--verbose",
    aliases: [],
    repeatable: false,
    required: false,
    valueArity: "required",
    optionLookingValuePolicy: "consume",
    placement: "anywhere",
    ...overrides,
  });
  const source = (id, route, fields) => ({
    kind: "delegated",
    id,
    commands: [{ id: `${id}.run`, route, summary: "Run.", fields }],
    execute: (request) => {
      executorCalls.push(request);
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  });
  const issuesOf = (sources) => {
    try {
      composeCommandSources(sources);
    } catch (error) {
      assert.ok(error instanceof CanonConstructionError);
      return error.issues.map(({ code, sourceId, commandId, field }) => ({ code, sourceId, commandId, field }));
    }
    assert.fail("composition must reject the conflicting declaration");
  };

  const shapeConflict = source("other", ["other"], [field({})]);
  const expected = [{ code: "FLAG_COLLISION", sourceId: "other", commandId: "other.run", field: "verbose" }];
  assert.deepEqual(issuesOf([canonical, shapeConflict]), expected);
  assert.deepEqual(issuesOf([shapeConflict, canonical]), expected, "independent of source order");

  const repeatConflict = source("zeta", ["zeta"], [field({ key: "tag", flag: "--tag", repeatable: false })]);
  assert.deepEqual(issuesOf([canonical, delegated, repeatConflict]), [
    { code: "FLAG_COLLISION", sourceId: "zeta", commandId: "zeta.run", field: "tag" },
  ]);
  const aliasConflict = source("alias", ["alias"], [field({ key: "p", flag: "--pick", aliases: ["-p"] })]);
  assert.deepEqual(issuesOf([canonical, delegated, aliasConflict]), [
    { code: "FLAG_COLLISION", sourceId: "external", commandId: "assets.sync", field: "profile" },
  ]);
  const reserved = source("shell", ["shell"], [field({ key: "version", kind: "flag", flag: "--version" })]);
  assert.deepEqual(issuesOf([canonical, reserved]), [
    { code: "FLAG_COLLISION", sourceId: "shell", commandId: "shell.run", field: "version" },
  ]);

  // Identical grammar across sources is not a conflict, and after-route fields never collide.
  composeCommandSources([canonical, delegated, source("same", ["same"], [field({ kind: "flag", key: "v" })])]);
  composeCommandSources([canonical, source("late", ["late"], [field({ placement: "after-route" })])]);

  await assert.rejects(
    executeNodeCli(product, ["--verbose", "other"], { delegatedSources: [shapeConflict] }),
    CanonConstructionError,
  );
  assert.deepEqual(executorCalls, []);
});

test("the composed runtime forwards no leading argv through a backend without the delegated capability", async () => {
  const { product, delegated, executorCalls } = fixture();
  const tree = composeCommandSources([{ kind: "canonical", id: "atelier", product }, delegated]);
  const backend = {
    parseLeading: (_scope, argv) => ({ status: "parsed", operands: argv, state: {} }),
    parseCommand: () => ({ status: "parsed", input: {} }),
  };
  const outcome = await executeComposedArgv(
    { tree, sources: [{ kind: "canonical", id: "atelier", product }, delegated] },
    { argv: ["assets", "sync", "--tag", "a"], backend, help: product },
  );
  assert.equal(outcome.status, "delegated");
  assert.deepEqual(
    executorCalls.map(({ argv }) => argv),
    [["--tag", "a"]],
  );
});

test("canonical-only products keep their anywhere behavior", async () => {
  const { product, calls } = fixture();
  assert.deepEqual(await executeNodeCli(product, ["--verbose", "assets", "inspect", "logo", "--scope", "x"]), {
    status: "success",
    commandId: "assets.inspect",
    result: { name: "logo", verbose: true, scope: "x" },
    presentation: "human",
  });
  const unknown = await executeNodeCli(product, ["--tag", "a", "assets", "inspect", "logo"]);
  assert.equal(unknown.status, "failure");
  assert.equal(unknown.usageFailure.code, "unknown-option");
  assert.equal(unknown.usageFailure.commandId, undefined);
  assert.deepEqual(calls, [["assets.inspect", "logo", true, "x"]]);
});
