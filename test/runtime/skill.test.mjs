import assert from "node:assert/strict";
import test from "node:test";
import * as z from "zod";
import {
  bindHandlers,
  CanonConstructionError,
  compileProduct,
  defineCommands,
  flag,
  option,
  positional,
  skillCommand,
  DEFAULT_SKILL_OUTPUT_BUDGET_BYTES,
  MIN_SKILL_OUTPUT_BUDGET_BYTES,
  OutputPolicyError,
  utf8ByteLength,
} from "../../dist/index.js";
import {
  defineSkills,
  projectSkill,
  projectSkills,
  renderSkillJson,
  renderSkillText,
  SkillConstructionError,
} from "../../dist/skill/index.js";

function fixture() {
  const commands = defineCommands({
    "document.render": {
      route: ["document", "render"],
      summary: "Render a document.",
      input: {
        file: positional(z.string(), { metavar: "file" }),
        out: option("--out", z.string(), { required: true, metavar: "path" }),
        draft: flag("--draft"),
      },
      result: z.object({ writtenFile: z.string() }),
    },
    "document.list": {
      route: ["document", "list"],
      summary: "List documents.",
      input: {},
      result: z.object({ count: z.number() }),
    },
  });
  const handlers = bindHandlers(commands)({
    "document.render": ({ out }) => ({ writtenFile: out }),
    "document.list": () => ({ count: 0 }),
  });
  const skills = defineSkills({
    "document.review": {
      summary: "Prepare a document for review.",
      steps: [
        { kind: "prose", text: "Choose the input document and output location." },
        {
          kind: "command",
          commandId: "document.render",
          guidance: "Render the chosen document.",
          prerequisites: ["The document is ready for review."],
        },
        {
          kind: "command",
          commandId: "document.list",
          guidance: "Check the available documents.",
        },
      ],
    },
    "document.policy": {
      summary: "Apply the document review policy.",
      steps: [{ kind: "prose", text: "Verify the document with its owner." }],
    },
  });
  return compileProduct({ name: "fixture", commands, handlers, skills });
}

test("Skill projection derives command metadata and preserves prose steps", () => {
  const product = fixture();
  const projected = projectSkill(product, "document.review");
  assert.deepEqual(projected.steps[0], {
    kind: "prose",
    text: "Choose the input document and output location.",
  });
  assert.deepEqual(projected.steps[1], {
    kind: "command",
    commandId: "document.render",
    guidance: "Render the chosen document.",
    prerequisites: ["The document is ready for review."],
    route: ["document", "render"],
    usage: "fixture document render <file> --out <path> [--draft]",
    help: { commandId: "document.render" },
    invocation: {
      state: "requires-input",
      commandId: "document.render",
      executable: "fixture",
      route: ["document", "render"],
      requirements: [
        { kind: "field", name: "file" },
        { kind: "field", name: "out" },
        { kind: "prerequisite", text: "The document is ready for review." },
      ],
    },
  });
  assert.deepEqual(projected.steps[2].invocation, {
    state: "ready",
    commandId: "document.list",
    value: { executable: "fixture", argv: ["document", "list"] },
  });
  assert.equal(projected.outputBudgetBytes, DEFAULT_SKILL_OUTPUT_BUDGET_BYTES);
  assert.deepEqual(
    projectSkills(product).map((skill) => skill.id),
    ["document.review", "document.policy"],
  );
  const expectedText =
    "Prepare a document for review.\n\nChoose the input document and output location.\n\nRender the chosen document.\nRun: fixture document render <file> --out <path> [--draft]\nRequires input: file, out\nRequires prerequisites: The document is ready for review.\nHelp: document.render\n\nCheck the available documents.\nRun: fixture document list\nHelp: document.list\n";
  const text = renderSkillText(projected);
  assert.equal(text, expectedText);
  assert.equal(renderSkillText(projected), text);
});

test("Skill JSON default budget fails explicitly and an explicit larger budget preserves complete content", () => {
  const projected = projectSkill(fixture(), "document.policy");
  const longText = "policy ".repeat(20_000);
  const withLongContent = {
    ...projected,
    steps: [{ kind: "prose", text: longText }],
  };
  assert.throws(
    () => renderSkillJson(withLongContent),
    (error) => error instanceof OutputPolicyError && error.failureKind === "budget",
  );
  const expected = `${JSON.stringify(withLongContent, null, 2)}\n`;
  const maxBytes = Buffer.byteLength(expected, "utf8");
  const json = renderSkillJson(withLongContent, { maxBytes });
  assert.equal(json, expected);
  assert.deepEqual(JSON.parse(json), withLongContent);
});

test("bounded Skill text and JSON use the shared byte budget without truncation", () => {
  const projected = projectSkill(fixture(), "document.policy");
  const text = renderSkillText(projected);
  const json = renderSkillJson(projected);
  const textBytes = Buffer.byteLength(text, "utf8");
  const jsonBytes = Buffer.byteLength(json, "utf8");

  assert.equal(renderSkillText(projected, { maxBytes: textBytes }), text);
  assert.throws(
    () => renderSkillText(projected, { maxBytes: textBytes - 1 }),
    (error) => error instanceof OutputPolicyError && error.failureKind === "budget",
  );

  const boundedJson = renderSkillJson(projected, { maxBytes: jsonBytes });
  assert.equal(boundedJson, json);
  assert.deepEqual(JSON.parse(boundedJson), projected);
  assert.throws(
    () => renderSkillJson(projected, { maxBytes: jsonBytes - 1 }),
    (error) => error instanceof OutputPolicyError && error.failureKind === "budget",
  );
  assert.ok(utf8ByteLength(boundedJson) <= jsonBytes);
});

test("Skill output budget defaults to 4096 and rejects invalid declared or selected budgets", () => {
  assert.equal(projectSkill(fixture(), "document.policy").outputBudgetBytes, 4096);
  assert.throws(
    () =>
      compileProduct({
        name: "fixture",
        commands: defineCommands({}),
        handlers: {},
        skills: defineSkills({
          invalid: {
            summary: "Invalid budget.",
            outputBudgetBytes: MIN_SKILL_OUTPUT_BUDGET_BYTES - 1,
            steps: [{ kind: "prose", text: "No." }],
          },
        }),
      }),
    (error) =>
      error instanceof SkillConstructionError &&
      error.issues.some((issue) => issue.code === "INVALID_SKILL_OUTPUT_BUDGET"),
  );
  const projected = projectSkill(fixture(), "document.policy");
  assert.throws(
    () => renderSkillText(projected, { maxBytes: MIN_SKILL_OUTPUT_BUDGET_BYTES - 1 }),
    (error) => error instanceof OutputPolicyError && error.failureKind === "budget",
  );
});

test("Skill command bindings derive a ready canonical invocation", () => {
  const commands = defineCommands({
    render: {
      route: ["render"],
      summary: "Render.",
      input: {
        file: positional(z.string()),
        out: option("--out", z.string(), { required: true }),
        draft: flag("--draft"),
      },
      result: z.object({}),
    },
  });
  const handlers = bindHandlers(commands)({ render: () => ({}) });
  const skills = defineSkills({
    ready: {
      summary: "Ready command.",
      steps: [
        skillCommand(commands, "render", {
          guidance: "Render now.",
          bindings: { file: "input.md", out: "out.html", draft: true },
        }),
      ],
    },
  });
  const projected = projectSkill(compileProduct({ name: "fixture", commands, handlers, skills }), "ready");
  assert.deepEqual(projected.steps[0].invocation, {
    state: "ready",
    commandId: "render",
    value: {
      executable: "fixture",
      argv: ["render", "input.md", "--out", "out.html", "--draft"],
    },
  });
});

test("Skill metadata and delegation are preserved and validated", () => {
  const skills = defineSkills({
    setup: {
      summary: "Prepare the product.",
      intent: "Establish a ready working context.",
      invariants: ["Never change product-owned authorization decisions."],
      references: [{ kind: "domain-result", id: "product.readiness" }],
      steps: [{ kind: "delegate", skillId: "details", guidance: "Continue with detailed review." }],
    },
    details: { summary: "Review details.", steps: [{ kind: "prose", text: "Inspect the existing result." }] },
  });
  const product = compileProduct({
    name: "fixture",
    commands: defineCommands({}),
    handlers: {},
    skills,
  });
  const projected = projectSkill(product, "setup");
  assert.equal(projected.intent, "Establish a ready working context.");
  assert.deepEqual(projected.invariants, ["Never change product-owned authorization decisions."]);
  assert.deepEqual(projected.references, [{ kind: "domain-result", id: "product.readiness" }]);
  assert.deepEqual(projected.steps[0], {
    kind: "delegate",
    skillId: "details",
    guidance: "Continue with detailed review.",
  });
  assert.deepEqual(JSON.parse(renderSkillJson(projected)), projected);
  const text = renderSkillText(projected);
  assert.match(text, /Intent:\nEstablish a ready working context\./);
  assert.match(text, /Invariants:\n- Never change product-owned authorization decisions\./);
  assert.match(text, /Domain result references:\n- product\.readiness/);
  assert.match(text, /Continue with Skill: details/);
  assert.equal(renderSkillText(projected), text);
});

test("Skill compilation rejects unknown delegation, cycles, and private commands", () => {
  const commands = defineCommands({
    internal: {
      route: ["internal"],
      summary: "Internal command.",
      visibility: "private",
      input: {},
      result: z.object({}),
    },
  });
  const handlers = bindHandlers(commands)({ internal: () => ({}) });
  const compileSkills = (skills) => compileProduct({ name: "fixture", commands, handlers, skills });
  assert.throws(
    () => compileSkills({ first: { summary: "A.", steps: [{ kind: "delegate", skillId: "missing" }] } }),
    (error) =>
      error instanceof SkillConstructionError && error.issues.some((issue) => issue.code === "UNKNOWN_SKILL_REFERENCE"),
  );
  assert.throws(
    () =>
      compileSkills({
        first: { summary: "A.", steps: [{ kind: "delegate", skillId: "second" }] },
        second: { summary: "B.", steps: [{ kind: "delegate", skillId: "first" }] },
      }),
    (error) =>
      error instanceof SkillConstructionError && error.issues.some((issue) => issue.code === "SKILL_DELEGATE_CYCLE"),
  );
  assert.throws(
    () =>
      compileSkills({
        first: { summary: "A.", steps: [{ kind: "command", commandId: "internal", guidance: "Run." }] },
      }),
    (error) =>
      error instanceof SkillConstructionError &&
      error.issues.some((issue) => issue.code === "PRIVATE_COMMAND_REFERENCE"),
  );
  assert.throws(
    () =>
      compileProduct({
        name: "fixture",
        commands: {
          internal: {
            route: ["internal"],
            summary: "Internal command.",
            visibility: "unknown",
            input: {},
            result: z.object({}),
          },
        },
        handlers: { internal: () => ({}) },
      }),
    (error) =>
      error instanceof CanonConstructionError &&
      error.issues.some((issue) => issue.code === "INVALID_COMMAND_VISIBILITY"),
  );
});

test("Skill compilation rejects unknown command references at construction", () => {
  const invalid = {
    broken: {
      summary: "Invalid reference.",
      steps: [{ kind: "command", commandId: "document.missing", guidance: "Cannot run." }],
    },
  };
  assert.throws(
    () =>
      compileProduct({
        name: "fixture",
        commands: defineCommands({
          list: { route: ["list"], summary: "List.", input: {}, result: z.object({ count: z.number() }) },
        }),
        handlers: { list: () => ({ count: 0 }) },
        skills: invalid,
      }),
    (error) =>
      error instanceof SkillConstructionError &&
      error.issues[0]?.code === "UNKNOWN_COMMAND_REFERENCE" &&
      error.issues[0]?.commandId === "document.missing",
  );
});
