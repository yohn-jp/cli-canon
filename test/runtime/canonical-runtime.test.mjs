import assert from "node:assert/strict";
import test from "node:test";
import * as z from "zod";
import {
  CanonicalRequestError,
  bindHandlers,
  compileProduct,
  defineCommands,
  defineGroups,
  executeCanonicalCommand,
  flag,
  option,
  positional,
  rawArgs,
} from "../../dist/index.js";

class FixtureDomainError extends Error {
  code = "FIXTURE_DOMAIN";
}

function fixture() {
  const calls = [];
  const commands = defineCommands({
    "document.render": {
      route: ["document", "render"],
      summary: "Render a document.",
      input: {
        file: positional(z.string().min(1)),
        out: option("--out", z.string().min(1), { required: true }),
        level: option("--level", z.coerce.number().int(), { valueArity: "optional" }),
        tag: option("--tag", z.string().min(1), { repeatable: true }),
        draft: flag("--draft"),
        args: rawArgs(),
      },
      result: z.object({ writtenFile: z.string(), level: z.number().optional(), tags: z.array(z.string()) }),
    },
    "math.double": {
      route: ["math", "double"],
      summary: "Double an integer.",
      input: { value: positional(z.coerce.number().int()) },
      result: z.object({ value: z.number().int() }),
    },
    "domain.fail": {
      route: ["domain", "fail"],
      summary: "Fail with a domain error.",
      input: {},
      result: z.object({}),
    },
    "result.invalid": {
      route: ["result", "invalid"],
      summary: "Return an invalid result.",
      input: {},
      result: z.object({ ok: z.literal(true) }),
    },
  });
  const groups = defineGroups({ document: { route: ["document"], summary: "Documents." } });
  const handlers = bindHandlers(commands)({
    "document.render": async (input) => {
      calls.push(input);
      return { writtenFile: input.out, level: input.level, tags: [...input.tag] };
    },
    "math.double": (input) => {
      calls.push(input);
      return { value: input.value * 2 };
    },
    "domain.fail": () => {
      throw new FixtureDomainError("domain refused");
    },
    "result.invalid": () => ({ ok: false }),
  });
  return { product: compileProduct({ name: "fixture", commands, groups, handlers }), calls };
}

test("typed success exposes command identity and validated result before presentation", async () => {
  const { product, calls } = fixture();
  const outcome = await executeCanonicalCommand(product, {
    route: ["document", "render"],
    input: { file: "in.md", out: "out.md", level: "3", tag: ["a", "b"], draft: true, args: ["--x"] },
  });
  assert.deepEqual(outcome, {
    status: "success",
    commandId: "document.render",
    route: ["document", "render"],
    result: { writtenFile: "out.md", level: 3, tags: ["a", "b"] },
  });
  assert.deepEqual(calls, [{ file: "in.md", out: "out.md", level: 3, tag: ["a", "b"], draft: true, args: ["--x"] }]);
  assert.equal("stdout" in outcome, false);
  assert.equal("exitCode" in outcome, false);
});

test("handlers receive decoded values for omitted optional tokens", async () => {
  const { product, calls } = fixture();
  const outcome = await executeCanonicalCommand(product, {
    route: ["document", "render"],
    input: { file: "in.md", out: "out.md", level: true, tag: [] },
  });
  assert.equal(outcome.status, "success");
  assert.deepEqual(calls, [{ file: "in.md", out: "out.md", level: undefined, tag: [], draft: false, args: [] }]);
});

test("input decode failure is a validation failure and the handler is not invoked", async () => {
  const { product, calls } = fixture();
  const outcome = await executeCanonicalCommand(product, { route: ["math", "double"], input: { value: "nope" } });
  assert.equal(outcome.status, "failure");
  assert.equal(outcome.failureKind, "validation");
  assert.equal(outcome.commandId, "math.double");
  assert.equal(outcome.field, "value");
  assert.ok(outcome.error instanceof z.ZodError);
  assert.deepEqual(calls, []);
});

test("handler throw is a handler-error carrying the product-owned domain error", async () => {
  const { product } = fixture();
  const outcome = await executeCanonicalCommand(product, { route: ["domain", "fail"] });
  assert.equal(outcome.failureKind, "handler-error");
  assert.equal(outcome.commandId, "domain.fail");
  assert.ok(outcome.error instanceof FixtureDomainError);
});

test("invalid handler result is a handler-result failure", async () => {
  const { product } = fixture();
  const outcome = await executeCanonicalCommand(product, { route: ["result", "invalid"] });
  assert.equal(outcome.failureKind, "handler-result");
  assert.equal(outcome.commandId, "result.invalid");
  assert.ok(outcome.error instanceof z.ZodError);
});

test("unresolvable routes are usage failures resolved through the canonical tree", async () => {
  const { product } = fixture();
  for (const [route, code] of [
    [["missing"], "unknown-command"],
    [["document", "missing"], "unknown-command"],
    [["math", "double", "extra"], "unknown-command"],
    [["math"], "unknown-command"],
    [["document"], "no-command"],
    [[], "no-command"],
  ]) {
    const outcome = await executeCanonicalCommand(product, { route });
    assert.deepEqual(
      outcome,
      { status: "failure", failureKind: "usage", usageFailure: { code, route } },
      route.join(" "),
    );
  }
});

test("missing required inputs are structured usage failures", async () => {
  const { product, calls } = fixture();
  assert.deepEqual(await executeCanonicalCommand(product, { route: ["document", "render"], input: { out: "o" } }), {
    status: "failure",
    failureKind: "usage",
    usageFailure: {
      code: "missing-positional-argument",
      route: ["document", "render"],
      commandId: "document.render",
      field: "file",
    },
  });
  assert.deepEqual(await executeCanonicalCommand(product, { route: ["document", "render"], input: { file: "f" } }), {
    status: "failure",
    failureKind: "usage",
    usageFailure: {
      code: "missing-required-option",
      route: ["document", "render"],
      commandId: "document.render",
      field: "out",
      option: "--out",
    },
  });
  assert.deepEqual(calls, []);
});

test("malformed adapter requests and broken bindings are unexpected failures", async () => {
  const { product, calls } = fixture();
  const unknownField = await executeCanonicalCommand(product, {
    route: ["math", "double"],
    input: { value: "1", extra: "1" },
  });
  assert.equal(unknownField.failureKind, "unexpected");
  assert.ok(unknownField.error instanceof CanonicalRequestError);
  const badToken = await executeCanonicalCommand(product, { route: ["math", "double"], input: { value: 1 } });
  assert.equal(badToken.failureKind, "unexpected");
  assert.equal(badToken.error.field, "value");
  const badRoute = await executeCanonicalCommand(product, { route: "math double" });
  assert.equal(badRoute.failureKind, "unexpected");
  const unbound = await executeCanonicalCommand({ tree: product.tree, handlers: {} }, { route: ["result", "invalid"] });
  assert.equal(unbound.failureKind, "unexpected");
  assert.equal(unbound.commandId, "result.invalid");
  assert.deepEqual(calls, []);
});

test("semantic execution performs no terminal IO and never exits", async () => {
  const { product } = fixture();
  const originals = {
    stdout: process.stdout.write,
    stderr: process.stderr.write,
    exit: process.exit,
    log: console.log,
    error: console.error,
  };
  const effects = [];
  process.stdout.write = () => effects.push("stdout");
  process.stderr.write = () => effects.push("stderr");
  process.exit = () => effects.push("exit");
  console.log = () => effects.push("console.log");
  console.error = () => effects.push("console.error");
  try {
    await executeCanonicalCommand(product, { route: ["math", "double"], input: { value: "2" } });
    await executeCanonicalCommand(product, { route: ["math", "double"], input: { value: "x" } });
    await executeCanonicalCommand(product, { route: ["domain", "fail"] });
    await executeCanonicalCommand(product, { route: ["result", "invalid"] });
    await executeCanonicalCommand(product, { route: ["missing"] });
  } finally {
    process.stdout.write = originals.stdout;
    process.stderr.write = originals.stderr;
    process.exit = originals.exit;
    console.log = originals.log;
    console.error = originals.error;
  }
  assert.deepEqual(effects, []);
});
