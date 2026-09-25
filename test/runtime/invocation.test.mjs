import assert from "node:assert/strict";
import test from "node:test";
import * as z from "zod";
import {
  InvocationProjectionError,
  bindHandlers,
  compileProduct,
  defineCommands,
  flag,
  option,
  positional,
  projectInvocation,
  rawArgs,
} from "../../dist/index.js";

function fixture() {
  const commands = defineCommands({
    "deploy.run": {
      route: ["deploy", "run"],
      summary: "Run a deployment.",
      input: {
        target: positional(z.string()),
        out: option("--out", z.string(), { required: true }),
        format: option("--format", z.enum(["full", "json"]), { valueArity: "optional" }),
        draft: flag("--draft"),
        tag: option("--tag", z.string(), { repeatable: true }),
        args: rawArgs(),
      },
      result: z.object({ ok: z.boolean() }),
    },
  });
  return compileProduct({
    name: "fixture",
    commands,
    handlers: bindHandlers(commands)({ "deploy.run": () => ({ ok: true }) }),
  });
}

test("canonical invocation lowers typed field bindings to executable and argv", () => {
  const projected = projectInvocation(fixture(), "deploy.run", {
    target: "input",
    out: "out.html",
    format: "full",
    draft: true,
    tag: ["a", "b"],
    args: ["--literal", "tail"],
  });
  assert.deepEqual(projected, {
    state: "ready",
    commandId: "deploy.run",
    value: {
      executable: "fixture",
      argv: [
        "deploy",
        "run",
        "input",
        "--out",
        "out.html",
        "--format",
        "full",
        "--draft",
        "--tag",
        "a",
        "--tag",
        "b",
        "--",
        "--literal",
        "tail",
      ],
    },
  });

  assert.deepEqual(
    projectInvocation(fixture(), "deploy.run", {
      target: "input",
      out: "out.html",
      format: true,
    }),
    {
      state: "ready",
      commandId: "deploy.run",
      value: {
        executable: "fixture",
        argv: ["deploy", "run", "input", "--out", "out.html", "--format"],
      },
    },
  );
});

test("missing required invocation bindings stay non-executable", () => {
  const projected = projectInvocation(fixture(), "deploy.run", { draft: true });
  assert.deepEqual(projected, {
    state: "requires-input",
    commandId: "deploy.run",
    executable: "fixture",
    route: ["deploy", "run"],
    requirements: [
      { kind: "field", name: "target" },
      { kind: "field", name: "out" },
    ],
  });
  assert.equal("value" in projected, false);
  assert.equal("argv" in projected, false);
});

test("invalid invocation bindings fail explicitly", () => {
  const product = fixture();
  for (const bindings of [
    { unknown: "value" },
    { target: 1, out: "out.html" },
    { target: "input", out: false },
    { target: "input", out: "out.html", draft: "yes" },
    { target: "input", out: "out.html", tag: "not-an-array" },
    { target: "input", out: "out.html", args: ["ok", 1] },
  ]) {
    assert.throws(
      () => projectInvocation(product, "deploy.run", bindings),
      (error) => error instanceof InvocationProjectionError && error.code === "INVALID_INVOCATION_BINDING",
    );
  }
});
