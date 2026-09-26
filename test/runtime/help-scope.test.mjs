import assert from "node:assert/strict";
import test from "node:test";
import * as z from "zod";
import {
  bindHandlers,
  compileProduct,
  defineCommands,
  defineGroups,
  flag,
  option,
  parseHelpMode,
  rawArgs,
} from "../../dist/index.js";
import { executeNodeCli } from "../../dist/node/index.js";

/**
 * The value command (`alpha` or `zulu`) declares `--foo <value>` (required value); the
 * unrelated `beta` declares the boolean flag `--foo`. The two value-command names sort
 * before and after `beta`, so each spelling is the last declaration in some product.
 * `tools run` carries optional-value, required-value, and anywhere/pre-route options.
 * `include` selects and orders the declared commands.
 */
function scopedProduct(include, valueName = "alpha") {
  const calls = [];
  const declarations = {
    value: {
      route: [valueName],
      summary: "Value.",
      input: { foo: option("--foo", z.string()) },
      result: z.object({ foo: z.string().optional() }),
    },
    beta: {
      route: ["beta"],
      summary: "Beta.",
      input: { foo: flag("--foo"), rest: rawArgs() },
      result: z.object({ foo: z.boolean(), rest: z.array(z.string()) }),
    },
    "tools.run": {
      route: ["tools", "run"],
      summary: "Run a tool.",
      input: {
        level: option("--level", z.coerce.number(), { valueArity: "optional" }),
        delta: option("--delta", z.coerce.number()),
        scope: option("--scope", z.string(), { placement: "anywhere" }),
      },
      result: z.object({}),
    },
  };
  const handlers = {
    value: ({ foo }) => (calls.push([valueName, foo]), { foo }),
    beta: ({ foo, rest }) => (calls.push(["beta", foo, rest]), { foo, rest: [...rest] }),
    "tools.run": (input) => (calls.push(["tools.run", input]), {}),
  };
  const id = (key) => (key === "value" ? valueName : key);
  const commands = defineCommands(Object.fromEntries(include.map((key) => [id(key), declarations[key]])));
  const product = compileProduct({
    name: "fixture",
    commands,
    handlers: bindHandlers(commands)(Object.fromEntries(include.map((key) => [id(key), handlers[key]]))),
    ...(include.includes("tools.run")
      ? { groups: defineGroups({ tools: { route: ["tools"], summary: "Tools." } }) }
      : {}),
  });
  return { product, calls };
}

const declarationOrders = [
  ["value", "beta", "tools.run"],
  ["beta", "value", "tools.run"],
  ["tools.run", "beta", "value"],
];
/** Every declaration order, with the value command sorting before (`alpha`) and after (`zulu`) `beta`. */
const products = ["alpha", "zulu"].flatMap((valueName) => declarationOrders.map((include) => [include, valueName]));

async function assertHelp(product, argv, request) {
  const parsed = parseHelpMode(product, argv);
  assert.deepEqual(parsed?.request, request, `parseHelpMode ${argv.join(" ")}`);
  const execution = await executeNodeCli(product, argv);
  assert.equal(execution.status, "help", argv.join(" "));
  assert.deepEqual(execution.request, request, argv.join(" "));
}

async function assertNotHelp(product, argv) {
  assert.equal(parseHelpMode(product, argv), undefined, `parseHelpMode ${argv.join(" ")}`);
  const execution = await executeNodeCli(product, argv);
  assert.notEqual(execution.status, "help", argv.join(" "));
  return execution;
}

test("a boolean flag keeps its own route's arity when an unrelated command declares a required-value option of the same spelling", async () => {
  for (const [include, valueName] of [[["beta"], "alpha"], ...products]) {
    const label = `${include.join(",")} ${valueName}`;
    const { product, calls } = scopedProduct(include, valueName);
    await assertHelp(product, ["beta", "--foo", "--help"], { kind: "command", commandId: "beta", mode: "text" });
    await assertHelp(product, ["beta", "--foo", "-h"], { kind: "command", commandId: "beta", mode: "text" });
    assert.deepEqual(calls, [], `help executes no handler (${label})`);
  }
});

test("a required-value option consumes a following help token regardless of an unrelated same-spelling flag", async () => {
  for (const [include, valueName] of [[["value"], "alpha"], [["value"], "zulu"], ...products]) {
    const label = `${include.join(",")} ${valueName}`;
    const { product, calls } = scopedProduct(include, valueName);
    const consumed = await assertNotHelp(product, [valueName, "--foo", "--help"]);
    assert.equal(consumed.status, "success", label);
    assert.deepEqual(calls, [[valueName, "--help"]], label);

    calls.length = 0;
    await assertHelp(product, [valueName, "--foo", "value", "--help"], {
      kind: "command",
      commandId: valueName,
      mode: "text",
    });
    assert.deepEqual(calls, [], `help executes no handler (${label})`);
  }
});

test("optional-value, required-value, and negative-number values are classified by the resolved command's grammar", async () => {
  for (const [include, valueName] of products) {
    const { product, calls } = scopedProduct(include, valueName);
    const run = { kind: "command", commandId: "tools.run", mode: "text" };
    await assertHelp(product, ["tools", "run", "--level", "--help"], run);
    await assertHelp(product, ["tools", "run", "--level", "2", "--help"], run);
    await assertHelp(product, ["tools", "run", "--level", "-3", "--help"], run);
    await assertHelp(product, ["tools", "run", "--delta", "-3", "--help"], run);
    await assertHelp(product, ["tools", "run", "--delta=--help", "-h"], run);
    assert.deepEqual(calls, [], "help executes no handler");
    for (const token of ["--help", "-h"]) {
      const consumed = await assertNotHelp(product, ["tools", "run", "--delta", token]);
      assert.equal(consumed.failureKind, "validation", `--delta ${token} is decoded as the option value`);
    }
    assert.deepEqual(calls, []);
  }
});

test("pre-route scope accepts only anywhere options; after-route options of any command do not consume there", async () => {
  for (const [include, valueName] of products) {
    const { product, calls } = scopedProduct(include, valueName);
    await assertHelp(product, ["--scope", "tools", "tools", "run", "--help"], {
      kind: "command",
      commandId: "tools.run",
      mode: "text",
    });
    await assertHelp(product, ["--scope", "tools", "--help"], { kind: "root", mode: "text" });
    await assertHelp(product, ["--foo", "beta", "--help"], { kind: "command", commandId: "beta", mode: "text" });
    await assertHelp(product, ["tools", "--help=full"], { kind: "route", route: ["tools"], mode: "full" });
    await assertNotHelp(product, ["--scope", "--help"]);
    assert.deepEqual(calls, [], `${include.join(",")} ${valueName}`);
  }
});

test("tokens after -- are payload, never help", async () => {
  for (const [include, valueName] of [[["beta"], "alpha"], ...products]) {
    const { product, calls } = scopedProduct(include, valueName);
    const execution = await assertNotHelp(product, ["beta", "--foo", "--", "--help"]);
    assert.equal(execution.status, "success", `${include.join(",")} ${valueName}`);
    assert.deepEqual(calls, [["beta", true, ["--help"]]]);
    assert.equal(parseHelpMode(product, ["--", "--help"]), undefined);
    assert.equal(parseHelpMode(product, ["beta", "--", "-h", "--help=full"]), undefined);
  }
});

test("delegated fields scope to their own route in a composed product", async () => {
  const { product, calls } = scopedProduct(["beta"]);
  const executorCalls = [];
  const delegated = {
    kind: "delegated",
    id: "external",
    commands: [
      {
        id: "external.gamma",
        route: ["gamma"],
        summary: "Gamma.",
        fields: [
          {
            key: "foo",
            kind: "option",
            flag: "--foo",
            aliases: [],
            repeatable: false,
            required: false,
            valueArity: "required",
            optionLookingValuePolicy: "consume",
            placement: "after-route",
          },
        ],
      },
    ],
    execute: (request) => {
      executorCalls.push(request);
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  };
  const beta = await executeNodeCli(product, ["beta", "--foo", "--help"], { delegatedSources: [delegated] });
  assert.equal(beta.status, "help");
  assert.deepEqual(beta.request, { kind: "command", commandId: "beta", mode: "text" });
  const gamma = await executeNodeCli(product, ["gamma", "--foo", "--help"], { delegatedSources: [delegated] });
  assert.notEqual(gamma.status, "help");
  assert.deepEqual(
    executorCalls.map(({ commandId, argv }) => [commandId, argv]),
    [["external.gamma", ["--foo", "--help"]]],
  );
  assert.deepEqual(calls, []);
});
