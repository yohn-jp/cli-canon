import assert from "node:assert/strict";
import test from "node:test";
import * as z from "zod";
import {
  bindHandlers,
  compileProduct,
  defineCommands,
  defineGroups,
  jsonOutput,
  option,
  positional,
  textOutput,
} from "../../dist/index.js";
import { executeNodeCli, projectNodeCliExecution, runNodeCli } from "../../dist/node/index.js";

class LockedError extends Error {
  constructor() {
    super("lock is held");
    this.code = "LOCKED";
  }
}

function failureFixture() {
  const calls = [];
  const commands = defineCommands({
    "item.add": {
      route: ["item", "add"],
      summary: "Add an item.",
      input: {
        name: positional(z.string().min(3)),
        tag: option("--tag", z.string(), { required: true }),
      },
      result: z.object({ name: z.string() }),
    },
    "item.sync": {
      route: ["item", "sync"],
      summary: "Sync items.",
      input: { remote: option("--remote", z.string(), { required: true, placement: "anywhere" }) },
      result: z.object({ remote: z.string() }),
    },
    "item.bad": {
      route: ["item", "bad"],
      summary: "Return an invalid result.",
      input: {},
      result: z.object({ ok: z.boolean() }),
    },
    "item.fail": { route: ["item", "fail"], summary: "Throw an unmapped error.", input: {}, result: z.object({}) },
    "item.lock": { route: ["item", "lock"], summary: "Throw a domain error.", input: {}, result: z.object({}) },
  });
  const product = compileProduct({
    name: "kit",
    commands,
    groups: defineGroups({ item: { route: ["item"], summary: "Work with items." } }),
    handlers: bindHandlers(commands)({
      "item.add": ({ name }) => {
        calls.push("item.add");
        return { name };
      },
      "item.sync": ({ remote }) => ({ remote }),
      "item.bad": () => ({ ok: "no" }),
      "item.fail": () => {
        throw new Error('boom "quoted"');
      },
      "item.lock": () => {
        throw new LockedError();
      },
    }),
  });
  return { product, calls };
}

const itemAddUsage = ["kit", "item", "add", "<name>", "--tag <tag>"];

function stripTrailingNewline(output) {
  assert.ok(output.endsWith("\n"), "a framework failure ends with its final newline");
  assert.equal(output.indexOf("\n"), output.length - 1, "a machine document is compact and single-line");
  return output.slice(0, -1);
}

/** Asserts one exact compact JSON document plus its final newline on stderr, and returns it parsed. */
function assertMachineFailure(result, { exitCode, failureKind, document }) {
  assert.equal(result.stdout, "");
  assert.equal(result.exitCode, exitCode);
  assert.equal(result.failureKind, failureKind);
  assert.equal(result.stderr, `${JSON.stringify(document)}\n`);
  const parsed = JSON.parse(stripTrailingNewline(result.stderr));
  assert.deepEqual(Object.keys(parsed), ["error"]);
  assert.deepEqual(Object.keys(parsed.error), Object.keys(document.error));
  assert.ok(!result.stderr.includes("parserCode"));
  assert.ok(!result.stderr.includes("commander."));
  return parsed;
}

test("human framework failure projections stay byte-exact", async () => {
  const { product } = failureFixture();
  assert.deepEqual(await runNodeCli(product, []), {
    exitCode: 2,
    stdout: "",
    stderr: "error: no command selected\n\nUsage: kit <command>\n",
    failureKind: "usage",
  });
  assert.deepEqual(await runNodeCli(product, ["item"]), {
    exitCode: 2,
    stdout: "",
    stderr: "error: no command selected\n\nUsage: kit item <command>\n",
    failureKind: "usage",
  });
  assert.deepEqual(await runNodeCli(product, ["nope"]), {
    exitCode: 2,
    stdout: "",
    stderr: "error: unknown command\n\nUsage: kit <command>\n",
    failureKind: "usage",
  });
  assert.deepEqual(await runNodeCli(product, ["item", "bad", "--zz"]), {
    exitCode: 2,
    stdout: "",
    stderr: "error: unknown option\n\nUsage: kit item bad\n",
    failureKind: "usage",
  });
  assert.deepEqual(await runNodeCli(product, ["--help=bad"]), {
    exitCode: 2,
    stdout: "",
    stderr: 'error: unknown help mode "bad"\n\nUsage: kit <command>\n',
    failureKind: "usage",
  });
  assert.deepEqual(await runNodeCli(product, ["item", "sync"]), {
    exitCode: 2,
    stdout: "",
    stderr: "error: required option '--remote' not specified\n\nUsage: kit item sync --remote <remote>\n",
    failureKind: "usage",
  });
  const validation = await runNodeCli(product, ["item", "add", "ab", "--tag", "t"]);
  assert.equal(validation.exitCode, 2);
  assert.equal(validation.failureKind, "validation");
  assert.match(validation.stderr, /^INVALID_INPUT: [\s\S]*too_small[\s\S]*\n$/u);
  const handlerResult = await runNodeCli(product, ["item", "bad"]);
  assert.equal(handlerResult.exitCode, 1);
  assert.equal(handlerResult.failureKind, "handler-result");
  assert.match(handlerResult.stderr, /^INVALID_HANDLER_RESULT: [\s\S]*invalid_type[\s\S]*\n$/u);
  assert.deepEqual(await runNodeCli(product, ["item", "fail"]), {
    exitCode: 1,
    stdout: "",
    stderr: 'UNEXPECTED: boom "quoted"\n',
    failureKind: "unexpected",
  });
});

test("machine usage failures are the canonical compact JSON document on stderr", async () => {
  const { product, calls } = failureFixture();
  const cases = [
    {
      argv: ["--json"],
      error: { kind: "usage", code: "no-command", message: "no command selected", usage: ["kit", "<command>"] },
    },
    {
      argv: ["item", "--json"],
      error: { kind: "usage", code: "no-command", message: "no command selected", usage: ["kit", "item", "<command>"] },
    },
    {
      argv: ["nope", "--json"],
      error: { kind: "usage", code: "unknown-command", message: "unknown command", usage: ["kit", "<command>"] },
    },
    {
      argv: ["--json", "--zz"],
      error: { kind: "usage", code: "unknown-option", message: "unknown option", usage: ["kit", "<command>"] },
    },
    {
      argv: ["item", "bad", "--zz", "--json"],
      error: {
        kind: "usage",
        code: "unknown-option",
        message: "unknown option",
        usage: ["kit", "item", "bad"],
        commandId: "item.bad",
      },
    },
    {
      argv: ["--json", "item", "--json=1"],
      error: { kind: "usage", code: "unknown-option", message: "unknown option", usage: ["kit", "<command>"] },
    },
    {
      argv: ["item", "add", "abc", "--tag", "t", "extra", "--json"],
      error: {
        kind: "usage",
        code: "extra-positional-argument",
        message: "too many arguments",
        usage: itemAddUsage,
        commandId: "item.add",
      },
    },
    {
      argv: ["item", "add", "--json"],
      error: {
        kind: "usage",
        code: "missing-required-option",
        message: "required option not specified",
        usage: itemAddUsage,
        commandId: "item.add",
      },
    },
    {
      argv: ["item", "add", "abc", "--json", "--tag"],
      error: {
        kind: "usage",
        code: "missing-option-value",
        message: "option value missing",
        usage: itemAddUsage,
        commandId: "item.add",
      },
    },
    {
      argv: ["item", "sync", "--json"],
      error: {
        kind: "usage",
        code: "missing-required-option",
        message: "required option '--remote' not specified",
        usage: ["kit", "item", "sync", "--remote <remote>"],
        commandId: "item.sync",
        option: "--remote",
      },
    },
    {
      argv: ["--json", "--help=bad"],
      error: {
        kind: "usage",
        code: "invalid-help-mode",
        message: 'unknown help mode "bad"',
        usage: ["kit", "<command>"],
        value: "bad",
      },
    },
  ];
  for (const { argv, error } of cases) {
    const execution = await executeNodeCli(product, argv);
    assert.equal(execution.presentation, "machine", argv.join(" "));
    assertMachineFailure(await runNodeCli(product, argv), { exitCode: 2, failureKind: "usage", document: { error } });
  }
  assert.deepEqual(calls, []);
});

test("machine usage omits absent optional keys and never projects backend diagnostics", () => {
  const usage = ["kit", "item", "add", "<name>"];
  const project = (usageFailure) =>
    projectNodeCliExecution({ status: "failure", presentation: "machine", failureKind: "usage", usageFailure, usage });

  assertMachineFailure(project({ code: "unknown-option", parserCode: "commander.unknownOption" }), {
    exitCode: 2,
    failureKind: "usage",
    document: { error: { kind: "usage", code: "unknown-option", message: "unknown option", usage } },
  });
  assertMachineFailure(
    project({
      value: "v",
      option: "--tag",
      parserCode: "commander.missingMandatoryOptionValue",
      commandId: "item.add",
      code: "missing-required-option",
      route: ["item", "add"],
      field: "tag",
    }),
    {
      exitCode: 2,
      failureKind: "usage",
      document: {
        error: {
          kind: "usage",
          code: "missing-required-option",
          message: "required option '--tag' not specified",
          usage,
          commandId: "item.add",
          option: "--tag",
          value: "v",
        },
      },
    },
  );
  assertMachineFailure(project({ code: "invalid-help-mode", value: "bad", commandId: "item.add" }), {
    exitCode: 2,
    failureKind: "usage",
    document: {
      error: {
        kind: "usage",
        code: "invalid-help-mode",
        message: 'unknown help mode "bad"',
        usage,
        commandId: "item.add",
        value: "bad",
      },
    },
  });
  const human = projectNodeCliExecution({
    status: "failure",
    presentation: "human",
    failureKind: "usage",
    usageFailure: { code: "unknown-option", parserCode: "commander.unknownOption" },
    usage,
  });
  assert.equal(human.stderr, "error: unknown option\n\nUsage: kit item add <name>\n");
});

test("machine validation, handler-result, unexpected, and unmapped handler failures keep stream and exit code", async () => {
  const { product } = failureFixture();
  const humanMessage = (stderr, label) => {
    assert.ok(stderr.startsWith(`${label}: `));
    return stderr.slice(label.length + 2, -1);
  };

  const humanValidation = await runNodeCli(product, ["item", "add", "ab", "--tag", "t"]);
  assertMachineFailure(await runNodeCli(product, ["item", "add", "ab", "--tag", "t", "--json"]), {
    exitCode: 2,
    failureKind: "validation",
    document: { error: { kind: "validation", message: humanMessage(humanValidation.stderr, "INVALID_INPUT") } },
  });

  const humanHandlerResult = await runNodeCli(product, ["item", "bad"]);
  assertMachineFailure(await runNodeCli(product, ["--json", "item", "bad"]), {
    exitCode: 1,
    failureKind: "handler-result",
    document: {
      error: { kind: "handler-result", message: humanMessage(humanHandlerResult.stderr, "INVALID_HANDLER_RESULT") },
    },
  });

  const unmapped = assertMachineFailure(await runNodeCli(product, ["item", "fail", "--json"]), {
    exitCode: 1,
    failureKind: "unexpected",
    document: { error: { kind: "unexpected", message: 'boom "quoted"' } },
  });
  assert.equal(unmapped.error.message, 'boom "quoted"');

  const nonMatchingAdapter = { is: (_error) => false, map: () => assert.fail("unmatched errors are never mapped") };
  assertMachineFailure(
    await runNodeCli(product, ["item", "fail", "--json"], { domainErrorAdapter: nonMatchingAdapter }),
    {
      exitCode: 1,
      failureKind: "unexpected",
      document: { error: { kind: "unexpected", message: 'boom "quoted"' } },
    },
  );

  const machine = (failureKind, error) =>
    projectNodeCliExecution({ status: "failure", presentation: "machine", failureKind, error });
  assertMachineFailure(machine("unexpected", "plain"), {
    exitCode: 1,
    failureKind: "unexpected",
    document: { error: { kind: "unexpected", message: "plain" } },
  });
  assertMachineFailure(machine("validation", new Error("bad input")), {
    exitCode: 2,
    failureKind: "validation",
    document: { error: { kind: "validation", message: "bad input" } },
  });
  assertMachineFailure(machine("handler-result", new Error("bad result")), {
    exitCode: 1,
    failureKind: "handler-result",
    document: { error: { kind: "handler-result", message: "bad result" } },
  });
  assertMachineFailure(machine("handler-error", new Error("unmapped")), {
    exitCode: 1,
    failureKind: "unexpected",
    document: { error: { kind: "unexpected", message: "unmapped" } },
  });
});

test("mapped domain errors stay product-owned in machine mode", async () => {
  const { product } = failureFixture();
  const presentations = [];
  const domainErrorAdapter = {
    is: (error) => error instanceof LockedError,
    map: (error, presentation) => {
      presentations.push(presentation);
      return presentation === "machine"
        ? { exitCode: 7, stream: "stdout", output: `${JSON.stringify({ status: "locked", code: error.code })}\n` }
        : { exitCode: 7, stream: "stderr", output: `${error.code}: ${error.message}\n` };
    },
  };
  assert.deepEqual(await runNodeCli(product, ["item", "lock"], { domainErrorAdapter }), {
    exitCode: 7,
    stdout: "",
    stderr: "LOCKED: lock is held\n",
    failureKind: "domain",
  });
  assert.deepEqual(await runNodeCli(product, ["item", "lock", "--json"], { domainErrorAdapter }), {
    exitCode: 7,
    stdout: '{"status":"locked","code":"LOCKED"}\n',
    stderr: "",
    failureKind: "domain",
  });
  assert.deepEqual(presentations, ["human", "machine"]);

  const textAdapter = {
    is: (error) => error instanceof LockedError,
    map: () => ({ exitCode: 9, stream: "stderr", output: "product text\n" }),
  };
  assert.deepEqual(await runNodeCli(product, ["item", "lock", "--json"], { domainErrorAdapter: textAdapter }), {
    exitCode: 9,
    stdout: "",
    stderr: "product text\n",
    failureKind: "domain",
  });
});

test("special terminal surfaces cannot replace machine framework failures", async () => {
  const { product } = failureFixture();
  const special = { usageFailure: () => textOutput("special usage\n"), help: () => textOutput("special help\n") };
  const legacy = { usageFailure: () => textOutput("legacy usage\n") };
  assert.equal((await runNodeCli(product, [], { specialTerminalSurface: special })).stdout, "special usage\n");
  for (const options of [{ specialTerminalSurface: special }, { terminalAdapter: legacy }]) {
    assertMachineFailure(await runNodeCli(product, ["--json"], options), {
      exitCode: 2,
      failureKind: "usage",
      document: {
        error: { kind: "usage", code: "no-command", message: "no command selected", usage: ["kit", "<command>"] },
      },
    });
    assertMachineFailure(await runNodeCli(product, ["item", "fail", "--json"], options), {
      exitCode: 1,
      failureKind: "unexpected",
      document: { error: { kind: "unexpected", message: 'boom "quoted"' } },
    });
  }
});

test("machine failure documents are bounded without truncation", async () => {
  const { product } = failureFixture();
  const document =
    '{"error":{"kind":"usage","code":"no-command","message":"no command selected","usage":["kit","<command>"]}}\n';
  const bytes = Buffer.byteLength(document);

  assert.deepEqual(await runNodeCli(product, ["--json"], { maxOutputBytes: bytes }), {
    exitCode: 2,
    stdout: "",
    stderr: document,
    failureKind: "usage",
  });
  assert.deepEqual(await runNodeCli(product, ["--json"], { maxOutputBytes: bytes - 1 }), {
    exitCode: 1,
    stdout: "",
    stderr: `OUTPUT_BUDGET_EXCEEDED: output uses ${bytes} UTF-8 bytes; limit is ${bytes - 1} bytes.\n`,
    failureKind: "budget",
  });
  assert.deepEqual(await runNodeCli(product, ["--json"], { maxOutputBytes: 10 }), {
    exitCode: 1,
    stdout: "",
    stderr: "",
    failureKind: "budget",
  });

  const unexpected = '{"error":{"kind":"unexpected","message":"boom \\"quoted\\""}}\n';
  const unexpectedBytes = Buffer.byteLength(unexpected);
  assert.equal(
    (await runNodeCli(product, ["item", "fail", "--json"], { maxOutputBytes: unexpectedBytes })).stderr,
    unexpected,
  );
  const oversized = await runNodeCli(product, ["item", "fail", "--json"], { maxOutputBytes: unexpectedBytes - 1 });
  assert.deepEqual(oversized, {
    exitCode: 1,
    stdout: "",
    stderr: "OUTPUT_BUDGET_EXCEEDED\n",
    failureKind: "budget",
  });
  assert.throws(() => JSON.parse(oversized.stderr));

  assert.deepEqual(await runNodeCli(product, ["--json"], { maxOutputBytes: -1 }), {
    exitCode: 1,
    stdout: "",
    stderr: "OUTPUT_BUDGET_INVALID: maxBytes must be a non-negative safe integer.\n",
    failureKind: "budget",
  });
});

test("serialization and budget diagnostics stay output-policy text in machine mode", async () => {
  const { product } = failureFixture();
  const unserializable = { success: () => jsonOutput({ count: 1n }) };
  for (const argv of [
    ["item", "add", "abc", "--tag", "t"],
    ["item", "add", "abc", "--tag", "t", "--json"],
  ]) {
    assert.deepEqual(await runNodeCli(product, argv, { resultPresenter: unserializable }), {
      exitCode: 1,
      stdout: "",
      stderr: "OUTPUT_SERIALIZATION_FAILED: unsupported JSON value at count: bigint\n",
      failureKind: "serialization",
    });
    assert.deepEqual(await runNodeCli(product, argv, { maxOutputBytes: 5 }), {
      exitCode: 1,
      stdout: "",
      stderr: "",
      failureKind: "budget",
    });
    const oversized = { success: () => jsonOutput({ blob: "x".repeat(100) }) };
    assert.deepEqual(await runNodeCli(product, argv, { resultPresenter: oversized, maxOutputBytes: 60 }), {
      exitCode: 1,
      stdout: "",
      stderr: "OUTPUT_BUDGET_EXCEEDED\n",
      failureKind: "budget",
    });
  }
});
