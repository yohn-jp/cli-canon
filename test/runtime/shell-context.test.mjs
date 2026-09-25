import assert from "node:assert/strict";
import test from "node:test";
import * as z from "zod";
import {
  CanonConstructionError,
  bindHandlers,
  compileProduct,
  defineCommands,
  defineGroups,
  executeCanonicalArgv,
  flag,
  jsonOutput,
  option,
  positional,
  rawArgs,
  textOutput,
} from "../../dist/index.js";
import { executeNodeCli, projectNodeCliExecution, runNodeCli } from "../../dist/node/index.js";

const packageMetadata = { name: "@example/kit", version: "1.2.3", bin: { kit: "./dist/cli.js" } };
const machineVersion = '{"name":"@example/kit","version":"1.2.3"}\n';

function shellFixture({ withPackageMetadata = true } = {}) {
  const calls = [];
  const commands = defineCommands({
    "document.render": {
      route: ["document", "render"],
      summary: "Render a document.",
      input: {
        file: positional(z.string().min(1)),
        out: option("--out", z.string(), { required: true }),
        args: rawArgs(),
      },
      result: z.object({ file: z.string(), out: z.string(), args: z.array(z.string()) }),
    },
    "status.show": {
      route: ["status"],
      summary: "Show status.",
      input: {},
      result: z.object({ healthy: z.boolean() }),
    },
  });
  const product = compileProduct({
    name: "kit",
    commands,
    groups: defineGroups({ document: { route: ["document"], summary: "Work with documents." } }),
    handlers: bindHandlers(commands)({
      "document.render": ({ file, out, args }) => {
        calls.push(["document.render", out, [...args]]);
        return { file, out, args: [...args] };
      },
      "status.show": () => {
        calls.push(["status.show"]);
        return { healthy: true };
      },
    }),
    ...(withPackageMetadata ? { packageMetadata } : {}),
  });
  return { product, calls };
}

/** A delegated source whose declared route grammar Canon scans but never parses. */
function delegatedSource(executorCalls) {
  return {
    kind: "delegated",
    id: "external",
    groups: [{ id: "external.auth", route: ["auth"], summary: "Manage sign-in." }],
    commands: [
      {
        id: "external.auth.login",
        route: ["auth", "login"],
        summary: "Sign in.",
        fields: [
          {
            key: "account",
            kind: "option",
            flag: "--account",
            aliases: [],
            repeatable: false,
            required: true,
            valueArity: "required",
            optionLookingValuePolicy: "consume",
            placement: "after-route",
          },
        ],
      },
    ],
    execute: (request) => {
      executorCalls.push(request);
      return { exitCode: 0, stdout: `${request.presentation} ${request.argv.join(" ")}\n`, stderr: "" };
    },
  };
}

test("root no-args is a no-command usage failure in human and machine presentation", async () => {
  const { product, calls } = shellFixture();
  assert.deepEqual(await executeNodeCli(product, []), {
    status: "failure",
    presentation: "human",
    failureKind: "usage",
    usageFailure: { code: "no-command" },
    usage: ["kit", "<command>"],
  });
  assert.deepEqual(await runNodeCli(product, []), {
    exitCode: 2,
    stdout: "",
    stderr: "error: no command selected\n\nUsage: kit <command>\n",
    failureKind: "usage",
  });

  const machine = await executeNodeCli(product, ["--json"]);
  assert.equal(machine.status, "failure");
  assert.equal(machine.presentation, "machine");
  assert.equal(machine.failureKind, "usage");
  assert.deepEqual(machine.usageFailure, { code: "no-command" });
  const terminal = await runNodeCli(product, ["--json", "--json"]);
  assert.equal(terminal.exitCode, 2);
  assert.equal(terminal.stdout, "");
  assert.equal(terminal.failureKind, "usage");
  assert.deepEqual(calls, []);
});

test("root, group, and command Help stay Canon-owned and machine Help is the discovery projection", async () => {
  const { product, calls } = shellFixture();
  for (const [argv, request, mode] of [
    [["--help"], { kind: "root", mode: "text" }, "summary"],
    [["document", "-h"], { kind: "route", route: ["document"], mode: "text" }, "summary"],
    [["document", "render", "--help=full"], { kind: "command", commandId: "document.render", mode: "full" }, "full"],
  ]) {
    const execution = await executeNodeCli(product, argv);
    assert.equal(execution.status, "help", argv.join(" "));
    assert.equal(execution.presentation, "human", argv.join(" "));
    assert.equal(execution.mode, mode, argv.join(" "));
    assert.deepEqual(execution.request, request, argv.join(" "));
    const terminal = await runNodeCli(product, argv);
    assert.equal(terminal.exitCode, 0);
    assert.match(terminal.stdout, /^Usage: kit/u);
  }

  for (const [argv, jsonArgv, options] of [
    [["--json", "--help"], ["--help=json"], {}],
    [["document", "--help=full", "--json"], ["document", "--help=json"], {}],
    [["document", "render", "-h", "--json"], ["document", "render", "--help=json"], { helpFormat: "full" }],
  ]) {
    const execution = await executeNodeCli(product, argv, options);
    assert.equal(execution.status, "help", argv.join(" "));
    assert.equal(execution.presentation, "machine", argv.join(" "));
    assert.equal(execution.mode, "json", argv.join(" "));
    const terminal = await runNodeCli(product, argv, options);
    assert.equal(terminal.exitCode, 0);
    assert.equal(terminal.stderr, "");
    assert.deepEqual(JSON.parse(terminal.stdout), JSON.parse((await runNodeCli(product, jsonArgv)).stdout));
  }

  const invalid = await executeNodeCli(product, ["--json", "--help=brief"]);
  assert.equal(invalid.presentation, "machine");
  assert.deepEqual(invalid.usageFailure, { code: "invalid-help-mode", value: "brief" });
  assert.equal((await runNodeCli(product, ["--json", "--help=brief"])).exitCode, 2);
  assert.deepEqual(calls, [], "Help never invokes a handler");
});

test("Help takes precedence over version and route execution", async () => {
  const { product, calls } = shellFixture();
  for (const argv of [
    ["--help", "--version"],
    ["--version", "--help"],
    ["--version", "-h", "--json"],
  ]) {
    const execution = await executeNodeCli(product, argv);
    assert.equal(execution.status, "help", argv.join(" "));
    assert.deepEqual(execution.request, { kind: "root", mode: "text" }, argv.join(" "));
  }
  const command = await executeNodeCli(product, ["status", "--version", "--help"]);
  assert.equal(command.status, "help");
  assert.deepEqual(command.request, { kind: "command", commandId: "status.show", mode: "text" });
  assert.deepEqual(calls, []);
});

test("the exact version request projects CompiledProduct.packageMetadata without invoking handlers", async () => {
  const { product, calls } = shellFixture();
  assert.deepEqual(await executeNodeCli(product, ["--version"]), {
    status: "version",
    presentation: "human",
    packageMetadata,
  });
  assert.deepEqual(await runNodeCli(product, ["--version"]), { exitCode: 0, stdout: "1.2.3\n", stderr: "" });
  for (const argv of [
    ["--json", "--version"],
    ["--version", "--json", "--json"],
  ]) {
    const execution = await executeNodeCli(product, argv);
    assert.equal(execution.status, "version", argv.join(" "));
    assert.equal(execution.presentation, "machine", argv.join(" "));
    assert.deepEqual(await runNodeCli(product, argv), { exitCode: 0, stdout: machineVersion, stderr: "" });
  }

  for (const argv of [["--version", "status"], ["status", "--version"], ["--version", "--version"], ["--version=1"]]) {
    const execution = await executeNodeCli(product, argv);
    assert.equal(execution.status, "failure", argv.join(" "));
    assert.equal(execution.failureKind, "usage", argv.join(" "));
    assert.equal(execution.usageFailure.code, "unknown-option", argv.join(" "));
    const terminal = await runNodeCli(product, argv);
    assert.equal(terminal.exitCode, 2, argv.join(" "));
    assert.equal(terminal.stdout, "", argv.join(" "));
  }
  assert.deepEqual(calls, [], "version requests never invoke a handler");
});

test("without packageMetadata --version is not admitted and fails through the grammar", async () => {
  const { product, calls } = shellFixture({ withPackageMetadata: false });
  const human = await executeNodeCli(product, ["--version"]);
  assert.equal(human.status, "failure");
  assert.equal(human.presentation, "human");
  assert.equal(human.failureKind, "usage");
  assert.equal(human.usageFailure.code, "unknown-option");
  assert.deepEqual(await runNodeCli(product, ["--version"]), {
    exitCode: 2,
    stdout: "",
    stderr: "error: unknown option\n\nUsage: kit <command>\n",
    failureKind: "usage",
  });
  const machine = await executeNodeCli(product, ["--json", "--version"]);
  assert.equal(machine.presentation, "machine");
  assert.equal(machine.usageFailure.code, "unknown-option");
  assert.deepEqual(calls, []);
});

test("--json selects machine presentation once and is removed before grammar parsing", async () => {
  const { product, calls } = shellFixture();
  const human = await executeNodeCli(product, ["document", "render", "in.md", "--out", "o.md"]);
  assert.equal(human.presentation, "human");

  const machine = await executeNodeCli(product, [
    "--json",
    "document",
    "--json",
    "render",
    "in.md",
    "--out=o.md",
    "--json",
  ]);
  assert.deepEqual(machine, {
    status: "success",
    commandId: "document.render",
    result: { file: "in.md", out: "o.md", args: [] },
    presentation: "machine",
  });
  assert.deepEqual(
    projectNodeCliExecution(machine),
    { exitCode: 0, stdout: '{"file":"in.md","out":"o.md","args":[]}\n', stderr: "" },
    "without a presenter a machine success is the same compact result JSON",
  );

  const optionValue = await executeNodeCli(product, ["document", "render", "in.md", "--out", "--json"]);
  assert.equal(optionValue.presentation, "human", "a declared option value is never a shell token");
  assert.equal(optionValue.result.out, "--json");

  const delimited = await executeNodeCli(product, ["document", "render", "in.md", "--out", "o.md", "--", "--json"]);
  assert.equal(delimited.presentation, "human", "tokens after -- are never shell tokens");
  assert.deepEqual(delimited.result.args, ["--json"]);

  const inline = await executeNodeCli(product, ["document", "render", "in.md", "--out", "o.md", "--json=yes"]);
  assert.equal(inline.presentation, "human");
  assert.equal(inline.failureKind, "usage");
  assert.equal(inline.usageFailure.code, "unknown-option");

  assert.deepEqual(calls, [
    ["document.render", "o.md", []],
    ["document.render", "o.md", []],
    ["document.render", "--json", []],
    ["document.render", "o.md", ["--json"]],
  ]);
});

test("the semantic runtime resolves shell controls before the grammar backend sees argv", async () => {
  const { product, calls } = shellFixture();
  const run = async (runtimeProduct, argv) => {
    const backendCalls = [];
    const outcome = await executeCanonicalArgv(runtimeProduct, {
      argv,
      help: runtimeProduct,
      backend: {
        parseLeading(scope, remaining) {
          backendCalls.push(["leading", [...remaining]]);
          return { status: "parsed", operands: remaining, state: undefined };
        },
        parseCommand(node, remaining) {
          backendCalls.push(["command", node.id, [...remaining]]);
          return { status: "parsed", input: {} };
        },
      },
    });
    return { outcome, backendCalls };
  };

  const machine = await run(product, ["--json", "status", "--json"]);
  assert.deepEqual(machine.outcome, {
    status: "success",
    commandId: "status.show",
    route: ["status"],
    result: { healthy: true },
    presentation: "machine",
  });
  assert.deepEqual(machine.backendCalls, [
    ["leading", ["status"]],
    ["command", "status.show", []],
  ]);

  const version = await run(product, ["--version", "--json"]);
  assert.deepEqual(version.outcome, { status: "version", packageMetadata, presentation: "machine" });
  assert.deepEqual(version.backendCalls, [], "a version request reaches no grammar backend");

  const { product: unversioned } = shellFixture({ withPackageMetadata: false });
  const unadmitted = await run(unversioned, ["--version"]);
  assert.deepEqual(unadmitted.backendCalls[0], ["leading", ["--version"]]);
  assert.deepEqual(calls, [["status.show"]]);
});

test("delegated executors receive the resolved presentation and argv without shell selectors", async () => {
  const { product, calls } = shellFixture();
  const executorCalls = [];
  const options = { delegatedSources: [delegatedSource(executorCalls)] };

  const machine = await executeNodeCli(product, ["auth", "login", "--json", "--account", "team"], options);
  assert.deepEqual(machine, {
    status: "delegated",
    presentation: "machine",
    sourceId: "external",
    commandId: "external.auth.login",
    result: { exitCode: 0, stdout: "machine --account team\n", stderr: "" },
  });
  const optionValue = await runNodeCli(product, ["auth", "login", "--account", "--json"], options);
  assert.equal(optionValue.stdout, "human --account --json\n");
  const delimited = await runNodeCli(product, ["--json", "auth", "login", "--", "--json"], options);
  assert.equal(delimited.stdout, "machine -- --json\n");
  assert.deepEqual(executorCalls, [
    {
      sourceId: "external",
      commandId: "external.auth.login",
      route: ["auth", "login"],
      argv: ["--account", "team"],
      presentation: "machine",
    },
    {
      sourceId: "external",
      commandId: "external.auth.login",
      route: ["auth", "login"],
      argv: ["--account", "--json"],
      presentation: "human",
    },
    {
      sourceId: "external",
      commandId: "external.auth.login",
      route: ["auth", "login"],
      argv: ["--", "--json"],
      presentation: "machine",
    },
  ]);

  executorCalls.length = 0;
  assert.equal((await executeNodeCli(product, ["auth", "login", "--json", "--help"], options)).status, "help");
  assert.equal((await runNodeCli(product, ["--version"], options)).stdout, "1.2.3\n");
  assert.deepEqual(executorCalls, [], "Help and version never invoke a delegated executor");
  assert.deepEqual(calls, []);
});

test("a heterogeneous result presenter narrows by commandId and reads the presentation context", async () => {
  const { product } = shellFixture();
  const resultPresenter = {
    success: (execution) => {
      switch (execution.commandId) {
        case "status.show":
          return execution.presentation === "machine"
            ? jsonOutput({ status: execution.result.healthy ? "healthy" : "degraded" })
            : textOutput(execution.result.healthy ? "healthy\n" : "degraded\n");
        case "document.render":
          return execution.presentation === "machine"
            ? jsonOutput({ rendered: execution.result.file })
            : textOutput(`rendered ${execution.result.file}\n`);
      }
    },
  };
  const run = (argv) => runNodeCli(product, argv, { resultPresenter });
  assert.equal((await run(["status"])).stdout, "healthy\n");
  assert.equal((await run(["status", "--json"])).stdout, '{"status":"healthy"}\n');
  assert.equal((await run(["document", "render", "in.md", "--out", "o.md"])).stdout, "rendered in.md\n");
  assert.equal(
    (await run(["--json", "document", "render", "in.md", "--out", "o.md"])).stdout,
    '{"rendered":"in.md"}\n',
  );
});

test("domain error adapters receive the mode and special surfaces are never applied in machine mode", async () => {
  const commands = defineCommands({
    "lock.take": { route: ["lock"], summary: "Take the lock.", input: {}, result: z.object({}) },
  });
  const product = compileProduct({
    name: "kit",
    commands,
    handlers: bindHandlers(commands)({
      "lock.take": () => {
        throw { code: "LOCKED" };
      },
    }),
  });
  const domainErrorAdapter = {
    is: (error) => typeof error === "object" && error !== null && error.code === "LOCKED",
    map: (error, presentation) =>
      presentation === "machine"
        ? { exitCode: 4, stream: "stdout", output: `${JSON.stringify({ code: error.code })}\n` }
        : { exitCode: 4, stream: "stderr", output: `${error.code}: lock is held\n` },
  };
  assert.deepEqual(await runNodeCli(product, ["lock"], { domainErrorAdapter }), {
    exitCode: 4,
    stdout: "",
    stderr: "LOCKED: lock is held\n",
    failureKind: "domain",
  });
  assert.deepEqual(await runNodeCli(product, ["lock", "--json"], { domainErrorAdapter }), {
    exitCode: 4,
    stdout: '{"code":"LOCKED"}\n',
    stderr: "",
    failureKind: "domain",
  });

  const specialTerminalSurface = {
    help: () => textOutput("special help\n"),
    usageFailure: () => textOutput("special usage\n"),
  };
  assert.equal((await runNodeCli(product, ["--help"], { specialTerminalSurface })).stdout, "special help\n");
  assert.equal((await runNodeCli(product, [], { specialTerminalSurface })).stdout, "special usage\n");
  const machineHelp = await runNodeCli(product, ["--help", "--json"], { specialTerminalSurface });
  assert.deepEqual(JSON.parse(machineHelp.stdout), JSON.parse((await runNodeCli(product, ["--help=json"])).stdout));
  const machineUsage = await runNodeCli(product, ["--json"], { specialTerminalSurface });
  assert.equal(machineUsage.exitCode, 2);
  assert.equal(machineUsage.stdout, "");
});

test("product fields cannot declare reserved standard-shell tokens", () => {
  for (const [key, field] of [
    ["json", flag("--json")],
    ["version", option("--version", z.string())],
    ["help", flag("--help")],
    ["short", flag("--short", { aliases: ["-h"] })],
  ]) {
    const commands = defineCommands({
      run: { route: ["run"], summary: "Run.", input: { [key]: field }, result: z.object({}) },
    });
    assert.throws(
      () => compileProduct({ name: "kit", commands, handlers: { run: () => ({}) } }),
      (error) =>
        error instanceof CanonConstructionError &&
        error.issues.some(({ code, field: issueField }) => code === "FLAG_COLLISION" && issueField === key),
      key,
    );
  }
});
