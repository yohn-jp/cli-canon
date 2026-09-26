import assert from "node:assert/strict";
import * as z from "zod";
import * as api from "@yohn-jp/cli-canon";
import * as node from "@yohn-jp/cli-canon/node";
import * as testing from "@yohn-jp/cli-canon/testing";

/**
 * Release-candidate certification of the standard shell, framework-failure, domain-error,
 * Node discriminant, and route-scoped Help contracts through the packed public exports.
 * Every expected document below is written from CANON §11 and §6.2; none is produced by
 * the Canon renderer under test.
 */

const documentedExports = {
  root: [
    "CanonConstructionError",
    "bindHandlers",
    "compilePaths",
    "compileProduct",
    "composeCommandProjection",
    "composeCommandSources",
    "defineCommands",
    "defineGroups",
    "definePaths",
    "defineSkills",
    "executeCanonicalCommand",
    "flag",
    "jsonOutput",
    "option",
    "parseHelpMode",
    "positional",
    "projectComposedCommandTree",
    "projectHelp",
    "projectInvocation",
    "projectProductSchemas",
    "projectSkill",
    "rawArgs",
    "renderSkillJson",
    "resolvePaths",
    "textOutput",
    "writeCliOutcome",
  ],
  node: ["executeNodeCli", "projectNodeCliExecution", "runNodeCli"],
  testing: ["certifyScenarios", "projectNodeTestTap"],
};

function certifyDocumentedExports() {
  for (const [surface, module] of [
    ["root", api],
    ["node", node],
    ["testing", testing],
  ]) {
    for (const name of documentedExports[surface]) {
      assert.equal(typeof module[name], "function", `${surface} export ${name}`);
    }
  }
  for (const name of [...documentedExports.node, ...documentedExports.testing]) {
    assert.equal(name in api, false, `${name} stays outside the root entrypoint`);
  }
}

const packageMetadata = { name: "rc-cli", version: "3.1.4", bin: { "rc-cli": "./bin/rc-cli.js" } };
const rootUsage = ["rc-cli", "<command>"];
const rootHelp =
  "Usage: rc-cli <command>\n\nCommands:\n  list\tList entries.\n  pass\tPass raw arguments.\n  tools\tTool commands.\n\n" +
  "Help: --help[=full|json]\n";
const toolsHelp =
  "Usage: rc-cli tools <command>\n\nTool commands.\n\nCommands:\n  count\tCount entries.\n\nHelp: --help[=full|json]\n";
const listHelp = "Usage: rc-cli list\n\nList entries.\n\nHelp: --help[=full|json]\n";

function shellProduct(options = {}) {
  const calls = [];
  const commands = api.defineCommands({
    "rc.list": {
      route: ["list"],
      summary: "List entries.",
      input: {},
      result: z.object({ entries: z.array(z.string()) }),
    },
    "rc.count": {
      route: ["tools", "count"],
      summary: "Count entries.",
      input: {},
      result: z.object({ total: z.number() }),
    },
    "rc.pass": {
      route: ["pass"],
      summary: "Pass raw arguments.",
      input: { rest: api.rawArgs() },
      result: z.object({ rest: z.array(z.string()) }),
    },
  });
  const product = api.compileProduct({
    name: "rc-cli",
    ...(options.unversioned ? {} : { packageMetadata }),
    commands,
    groups: api.defineGroups({ tools: { route: ["tools"], summary: "Tool commands." } }),
    handlers: api.bindHandlers(commands)({
      "rc.list": () => (calls.push("rc.list"), { entries: ["a", "b"] }),
      "rc.count": () => (calls.push("rc.count"), { total: 2 }),
      "rc.pass": ({ rest }) => (calls.push("rc.pass"), { rest: [...rest] }),
    }),
  });
  return { product, calls };
}

const machine = (error) => JSON.stringify({ error }) + "\n";
const ok = (stdout) => ({ exitCode: 0, stdout, stderr: "" });
const usageFailure = (stderr) => ({ exitCode: 2, stdout: "", stderr, failureKind: "usage" });

async function certifyStandardShell() {
  const { product, calls } = shellProduct();
  const run = (argv, options) => node.runNodeCli(product, argv, options);

  // Root no-args: usage failure on stderr with exit 2 in both modes, never Help.
  assert.deepEqual(await run([]), usageFailure("error: no command selected\n\nUsage: rc-cli <command>\n"));
  const noCommand = machine({ kind: "usage", code: "no-command", message: "no command selected", usage: rootUsage });
  assert.deepEqual(await run(["--json"]), usageFailure(noCommand));
  assert.deepEqual(await run(["--json", "--json"]), usageFailure(noCommand));
  assert.deepEqual(await run(["tools"]), usageFailure("error: no command selected\n\nUsage: rc-cli tools <command>\n"));
  assert.deepEqual(
    await run(["tools", "--json"]),
    usageFailure(
      machine({
        kind: "usage",
        code: "no-command",
        message: "no command selected",
        usage: ["rc-cli", "tools", "<command>"],
      }),
    ),
  );

  // Help: human text on stdout; machine mode is always the JSON discovery projection.
  for (const argv of [["--help"], ["-h"]]) assert.deepEqual(await run(argv), ok(rootHelp));
  assert.deepEqual(await run(["tools", "--help"]), ok(toolsHelp));
  assert.deepEqual(await run(["list", "--help"]), ok(listHelp));
  const rootDiscovery = JSON.parse((await run(["--json", "--help"])).stdout);
  assert.equal(rootDiscovery.name, "rc-cli");
  assert.deepEqual(
    rootDiscovery.commands.map(({ id }) => id),
    ["rc.list", "rc.pass", "rc.count"],
  );
  for (const argv of [["--help=full", "--json"], ["--json", "-h"], ["--help=json"], ["--help=summary", "--json"]]) {
    const result = await run(argv);
    assert.equal(result.exitCode, 0, argv.join(" "));
    assert.equal(result.stderr, "", argv.join(" "));
    assert.deepEqual(JSON.parse(result.stdout), rootDiscovery, argv.join(" "));
  }
  const toolsDiscovery = JSON.parse((await run(["tools", "--help", "--json"])).stdout);
  assert.deepEqual(
    toolsDiscovery.commands.map(({ id, route }) => [id, route]),
    [["rc.count", ["tools", "count"]]],
  );
  const invalidMode = {
    kind: "usage",
    code: "invalid-help-mode",
    message: 'unknown help mode "wide"',
    usage: rootUsage,
  };
  assert.deepEqual(
    await run(["--help=wide"]),
    usageFailure('error: unknown help mode "wide"\n\nUsage: rc-cli <command>\n'),
  );
  assert.deepEqual(await run(["--json", "--help=wide"]), usageFailure(machine({ ...invalidMode, value: "wide" })));

  // Version: exactly ["--version"] after --json removal; Help wins over version.
  assert.deepEqual(await run(["--version"]), ok("3.1.4\n"));
  assert.deepEqual(await run(["--json", "--version"]), ok('{"name":"rc-cli","version":"3.1.4"}\n'));
  assert.deepEqual(await run(["--version", "--json"]), ok('{"name":"rc-cli","version":"3.1.4"}\n'));
  assert.deepEqual(await run(["--version", "--help"]), ok(rootHelp));
  for (const argv of [
    ["--version", "--version"],
    ["list", "--version"],
  ]) {
    const execution = await node.executeNodeCli(product, argv);
    assert.equal(execution.failureKind, "usage", argv.join(" "));
    assert.equal(execution.usageFailure.code, "unknown-option", argv.join(" "));
  }
  const unversioned = shellProduct({ unversioned: true });
  const unadmitted = await node.executeNodeCli(unversioned.product, ["--version"]);
  assert.equal(unadmitted.failureKind, "usage");
  assert.equal(unadmitted.usageFailure.code, "unknown-option");
  assert.deepEqual(unversioned.calls, []);

  assert.deepEqual(calls, [], "no-args, Help, invalid Help mode, and version never execute a handler");

  // --json selects machine mode once and is removed before parsing; -- payload is never a selector.
  assert.deepEqual(await node.executeNodeCli(product, ["--json", "list", "--json"]), {
    status: "success",
    presentation: "machine",
    commandId: "rc.list",
    result: { entries: ["a", "b"] },
  });
  assert.deepEqual(await node.executeNodeCli(product, ["pass", "--", "--json", "--help", "--version"]), {
    status: "success",
    presentation: "human",
    commandId: "rc.pass",
    result: { rest: ["--json", "--help", "--version"] },
  });
  const selectorValue = await node.executeNodeCli(product, ["list", "--json=1"]);
  assert.equal(selectorValue.usageFailure.code, "unknown-option");
  assert.equal(selectorValue.presentation, "human");

  // Without a presenter, success is compact result JSON on stdout in both modes.
  assert.deepEqual(await run(["list"]), ok('{"entries":["a","b"]}\n'));
  assert.deepEqual(await run(["list", "--json"]), ok('{"entries":["a","b"]}\n'));
  assert.deepEqual(calls, ["rc.list", "rc.pass", "rc.list", "rc.list"]);

  // Construction rejects every reserved shell token as a product flag or alias.
  for (const [spelling, aliases] of [
    ["--json", []],
    ["--version", []],
    ["--help", []],
    ["--mode", ["-h"]],
  ]) {
    assert.throws(
      () =>
        api.compileProduct({
          name: "rc-cli",
          commands: api.defineCommands({
            run: {
              route: ["run"],
              summary: "Run.",
              input: { value: api.flag(spelling, { aliases }) },
              result: z.object({}),
            },
          }),
          handlers: { run: () => ({}) },
        }),
      (error) =>
        error instanceof api.CanonConstructionError && error.issues.some(({ code }) => code === "FLAG_COLLISION"),
      spelling,
    );
  }
}

async function certifyNodeDiscriminant() {
  const { product } = shellProduct();
  const seen = [];
  const resultPresenter = {
    success: (execution) => {
      seen.push([execution.commandId, execution.presentation, execution.result]);
      return execution.commandId === "rc.list"
        ? api.textOutput(execution.result.entries.join(",") + "\n")
        : api.textOutput(`total=${execution.result.total}\n`);
    },
  };
  assert.deepEqual(await node.runNodeCli(product, ["list"], { resultPresenter }), ok("a,b\n"));
  assert.deepEqual(await node.runNodeCli(product, ["tools", "count", "--json"], { resultPresenter }), ok("total=2\n"));
  assert.deepEqual(seen, [
    ["rc.list", "human", { entries: ["a", "b"] }],
    ["rc.count", "machine", { total: 2 }],
  ]);
  assert.deepEqual(await node.executeNodeCli(product, ["tools", "count"]), {
    status: "success",
    presentation: "human",
    commandId: "rc.count",
    result: { total: 2 },
  });
}

class LockedError extends Error {}

function failureProduct() {
  const calls = [];
  const valueSchema = z.string().min(3, "value needs three characters");
  const resultSchema = z.object({ ok: z.boolean() });
  const commands = api.defineCommands({
    "rc.echo": {
      route: ["echo"],
      summary: "Echo a value.",
      input: { value: api.option("--value", valueSchema, { required: true }) },
      result: z.object({ value: z.string() }),
    },
    "rc.bad": { route: ["bad"], summary: "Return an invalid result.", input: {}, result: resultSchema },
    "rc.fail": { route: ["fail"], summary: "Throw an unmapped error.", input: {}, result: z.object({}) },
    "rc.raw": { route: ["raw"], summary: "Throw a non-Error value.", input: {}, result: z.object({}) },
    "rc.lock": { route: ["lock"], summary: "Throw a domain error.", input: {}, result: z.object({}) },
  });
  const product = api.compileProduct({
    name: "rc-cli",
    commands,
    handlers: api.bindHandlers(commands)({
      "rc.echo": ({ value }) => (calls.push("rc.echo"), { value }),
      "rc.bad": () => (calls.push("rc.bad"), { ok: "no" }),
      "rc.fail": () => {
        calls.push("rc.fail");
        throw new Error("disk vanished");
      },
      "rc.raw": () => {
        calls.push("rc.raw");
        throw "raw failure";
      },
      "rc.lock": () => {
        calls.push("rc.lock");
        throw new LockedError("resource locked");
      },
    }),
  });
  return {
    product,
    calls,
    validationMessage: valueSchema.safeParse("ab").error.message,
    handlerResultMessage: resultSchema.safeParse({ ok: "no" }).error.message,
  };
}

async function certifyFrameworkFailures() {
  const { product, calls, validationMessage, handlerResultMessage } = failureProduct();
  const run = (argv, options) => node.runNodeCli(product, argv, options);
  const failure = (exitCode, stderr, failureKind) => ({ exitCode, stdout: "", stderr, failureKind });

  // §11.5 human and machine projections: same stream and exit code, encoding only differs.
  const matrix = [
    {
      argv: ["echo", "--value", "abc", "--extra"],
      exitCode: 2,
      failureKind: "usage",
      human: "error: unknown option\n\nUsage: rc-cli echo --value <value>\n",
      machine: machine({
        kind: "usage",
        code: "unknown-option",
        message: "unknown option",
        usage: ["rc-cli", "echo", "--value <value>"],
        commandId: "rc.echo",
      }),
    },
    {
      argv: ["nope"],
      exitCode: 2,
      failureKind: "usage",
      human: "error: unknown command\n\nUsage: rc-cli <command>\n",
      machine: machine({
        kind: "usage",
        code: "unknown-command",
        message: "unknown command",
        usage: ["rc-cli", "<command>"],
      }),
    },
    {
      argv: ["echo", "--value", "ab"],
      exitCode: 2,
      failureKind: "validation",
      human: `INVALID_INPUT: ${validationMessage}\n`,
      machine: machine({ kind: "validation", message: validationMessage }),
    },
    {
      argv: ["bad"],
      exitCode: 1,
      failureKind: "handler-result",
      human: `INVALID_HANDLER_RESULT: ${handlerResultMessage}\n`,
      machine: machine({ kind: "handler-result", message: handlerResultMessage }),
    },
    {
      argv: ["fail"],
      exitCode: 1,
      failureKind: "unexpected",
      human: "UNEXPECTED: disk vanished\n",
      machine: machine({ kind: "unexpected", message: "disk vanished" }),
    },
    {
      argv: ["raw"],
      exitCode: 1,
      failureKind: "unexpected",
      human: "UNEXPECTED: raw failure\n",
      machine: machine({ kind: "unexpected", message: "raw failure" }),
    },
    {
      argv: ["lock"],
      exitCode: 1,
      failureKind: "unexpected",
      human: "UNEXPECTED: resource locked\n",
      machine: machine({ kind: "unexpected", message: "resource locked" }),
    },
  ];
  for (const { argv, exitCode, failureKind, human, machine: document } of matrix) {
    assert.deepEqual(await run(argv), failure(exitCode, human, failureKind), argv.join(" "));
    assert.deepEqual(
      await run([...argv, "--json"]),
      failure(exitCode, document, failureKind),
      `${argv.join(" ")} --json`,
    );
    assert.deepEqual(
      await run(["--json", ...argv]),
      failure(exitCode, document, failureKind),
      `--json ${argv.join(" ")}`,
    );
  }
  assert.deepEqual(
    calls,
    ["bad", "fail", "raw", "lock"].flatMap((command) => Array(3).fill(`rc.${command}`)),
    "usage and validation failures execute no handler",
  );

  // Budget: an exact-fit machine document is written; one byte less is the text budget failure.
  const validationDocument = machine({ kind: "validation", message: validationMessage });
  const bytes = Buffer.byteLength(validationDocument);
  assert.equal((await run(["echo", "--value", "ab", "--json"], { maxOutputBytes: bytes })).stderr, validationDocument);
  assert.deepEqual(
    await run(["echo", "--value", "ab", "--json"], { maxOutputBytes: bytes - 1 }),
    failure(1, `OUTPUT_BUDGET_EXCEEDED: output uses ${bytes} UTF-8 bytes; limit is ${bytes - 1} bytes.\n`, "budget"),
  );

  // Serialization stays a text diagnostic in machine mode.
  assert.deepEqual(
    await run(["echo", "--value", "abc", "--json"], {
      resultPresenter: { success: () => api.jsonOutput({ count: 1n }) },
    }),
    failure(1, "OUTPUT_SERIALIZATION_FAILED: unsupported JSON value at count: bigint\n", "serialization"),
  );
}

async function certifyDomainErrorSeparation() {
  const { product, calls, validationMessage } = failureProduct();
  const consulted = [];
  const domainErrorAdapter = {
    is: (error) => (consulted.push(error instanceof LockedError), error instanceof LockedError),
    map: (error, presentation) =>
      presentation === "machine"
        ? { exitCode: 7, stream: "stdout", output: JSON.stringify({ locked: error.message }) + "\n" }
        : { exitCode: 7, stream: "stderr", output: `locked: ${error.message}\n` },
  };
  const run = (argv) => node.runNodeCli(product, argv, { domainErrorAdapter });

  // The product owns the mapped domain failure's bytes, stream, and exit code in both modes.
  assert.deepEqual(await run(["lock"]), {
    exitCode: 7,
    stdout: "",
    stderr: "locked: resource locked\n",
    failureKind: "domain",
  });
  assert.deepEqual(await run(["lock", "--json"]), {
    exitCode: 7,
    stdout: '{"locked":"resource locked"}\n',
    stderr: "",
    failureKind: "domain",
  });
  // An unmatched handler error stays a Canon unexpected failure.
  assert.deepEqual(await run(["fail", "--json"]), {
    exitCode: 1,
    stdout: "",
    stderr: machine({ kind: "unexpected", message: "disk vanished" }),
    failureKind: "unexpected",
  });
  consulted.length = 0;
  // Framework failures never reach the domain adapter.
  assert.equal(
    (await run(["echo", "--value", "ab", "--json"])).stderr,
    machine({ kind: "validation", message: validationMessage }),
  );
  assert.equal((await run(["bad", "--json"])).failureKind, "handler-result");
  assert.equal((await run(["--json"])).failureKind, "usage");
  assert.deepEqual(consulted, []);
  assert.deepEqual(calls, ["rc.lock", "rc.lock", "rc.fail", "rc.bad"]);

  // Special surfaces are never applied in machine mode.
  const specialTerminalSurface = {
    help: () => api.textOutput("special help\n"),
    usageFailure: () => api.textOutput("special usage\n"),
  };
  assert.deepEqual(await node.runNodeCli(product, ["--json"], { specialTerminalSurface }), {
    exitCode: 2,
    stdout: "",
    stderr: machine({
      kind: "usage",
      code: "no-command",
      message: "no command selected",
      usage: ["rc-cli", "<command>"],
    }),
    failureKind: "usage",
  });
  assert.equal(
    JSON.parse((await node.runNodeCli(product, ["--help", "--json"], { specialTerminalSurface })).stdout).name,
    "rc-cli",
  );
}

function scopedProduct(valueName, order) {
  const calls = [];
  const declarations = {
    value: {
      route: [valueName],
      summary: "Value.",
      input: { foo: api.option("--foo", z.string()) },
      result: z.object({ foo: z.string().optional() }),
    },
    beta: {
      route: ["beta"],
      summary: "Beta.",
      input: { foo: api.flag("--foo"), rest: api.rawArgs() },
      result: z.object({ foo: z.boolean(), rest: z.array(z.string()) }),
    },
    "tools.run": {
      route: ["tools", "run"],
      summary: "Run a tool.",
      input: {
        level: api.option("--level", z.coerce.number(), { valueArity: "optional" }),
        delta: api.option("--delta", z.coerce.number()),
        scope: api.option("--scope", z.string(), { placement: "anywhere" }),
      },
      result: z.object({}),
    },
  };
  const handlers = {
    value: ({ foo }) => (calls.push([valueName, foo]), { foo }),
    beta: ({ foo, rest }) => (calls.push(["beta", foo, [...rest]]), { foo, rest: [...rest] }),
    "tools.run": () => (calls.push(["tools.run"]), {}),
  };
  const id = (key) => (key === "value" ? valueName : key);
  const commands = api.defineCommands(Object.fromEntries(order.map((key) => [id(key), declarations[key]])));
  const product = api.compileProduct({
    name: "rc-cli",
    commands,
    groups: api.defineGroups({ tools: { route: ["tools"], summary: "Tools." } }),
    handlers: api.bindHandlers(commands)(Object.fromEntries(order.map((key) => [id(key), handlers[key]]))),
  });
  return { product, calls };
}

async function certifyRouteScopedHelp() {
  const command = (commandId) => ({ kind: "command", commandId, mode: "text" });
  for (const valueName of ["alpha", "zulu"]) {
    for (const order of [
      ["value", "beta", "tools.run"],
      ["beta", "value", "tools.run"],
      ["tools.run", "beta", "value"],
    ]) {
      const label = `${valueName} ${order.join(",")}`;
      const { product, calls } = scopedProduct(valueName, order);
      const assertHelp = async (argv, request) => {
        assert.deepEqual(api.parseHelpMode(product, argv)?.request, request, `${label}: ${argv.join(" ")}`);
        const execution = await node.executeNodeCli(product, argv);
        assert.equal(execution.status, "help", `${label}: ${argv.join(" ")}`);
        assert.deepEqual(execution.request, request, `${label}: ${argv.join(" ")}`);
      };
      const assertNotHelp = async (argv) => {
        assert.equal(api.parseHelpMode(product, argv), undefined, `${label}: ${argv.join(" ")}`);
        const execution = await node.executeNodeCli(product, argv);
        assert.notEqual(execution.status, "help", `${label}: ${argv.join(" ")}`);
        return execution;
      };

      // Counterexample: an unrelated required-value --foo never changes beta's boolean --foo.
      await assertHelp(["beta", "--foo", "--help"], command("beta"));
      await assertHelp(["beta", "--foo", "-h"], command("beta"));
      // Required value: the following token is the option value, not Help.
      assert.equal((await assertNotHelp([valueName, "--foo", "--help"])).status, "success");
      await assertHelp([valueName, "--foo", "value", "--help"], command(valueName));
      // Optional value, negative-number values, and --opt=value.
      await assertHelp(["tools", "run", "--level", "--help"], command("tools.run"));
      await assertHelp(["tools", "run", "--level", "2", "--help"], command("tools.run"));
      await assertHelp(["tools", "run", "--level", "-3", "--help"], command("tools.run"));
      await assertHelp(["tools", "run", "--delta", "-3", "--help"], command("tools.run"));
      await assertHelp(["tools", "run", "--delta=--help", "-h"], command("tools.run"));
      for (const token of ["--help", "-h"]) {
        assert.equal((await assertNotHelp(["tools", "run", "--delta", token])).failureKind, "validation");
      }
      // Pre-route scope admits only anywhere options.
      await assertHelp(["--scope", "tools", "tools", "run", "--help"], command("tools.run"));
      await assertHelp(["--scope", "tools", "--help"], { kind: "root", mode: "text" });
      await assertHelp(["--foo", "beta", "--help"], command("beta"));
      await assertHelp(["tools", "--help=full"], { kind: "route", route: ["tools"], mode: "full" });
      await assertNotHelp(["--scope", "--help"]);
      // Tokens after -- are payload, never Help.
      assert.equal((await assertNotHelp(["beta", "--foo", "--", "--help"])).status, "success");
      assert.equal(api.parseHelpMode(product, ["--", "--help"]), undefined);
      assert.equal(api.parseHelpMode(product, ["beta", "--", "-h", "--help=full"]), undefined);

      assert.deepEqual(
        calls,
        [
          [valueName, "--help"],
          ["beta", true, ["--help"]],
        ],
        `${label}: Help executes no handler`,
      );
    }
  }
}

export async function certifyReleaseCandidate() {
  certifyDocumentedExports();
  await certifyStandardShell();
  await certifyNodeDiscriminant();
  await certifyFrameworkFailures();
  await certifyDomainErrorSeparation();
  await certifyRouteScopedHelp();
}
