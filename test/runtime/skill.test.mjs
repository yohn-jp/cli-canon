import assert from "node:assert/strict";
import test from "node:test";
import * as z from "zod";
import {
  bindHandlers,
  compileProduct,
  defineCommands,
  flag,
  option,
  positional,
} from "../../dist/index.js";
import {
  compileSkills,
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
        json: flag("--json"),
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
  const product = compileProduct({ name: "fixture", commands, handlers });
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
  return { ...product, skills: compileSkills(skills, product.commands) };
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
    usage: "fixture document render <file> --out <path> [--json]",
    help: { commandId: "document.render" },
    invocation: {
      state: "requires-input",
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
    route: ["document", "list"],
  });
  assert.deepEqual(projectSkills(product).map((skill) => skill.id), ["document.review", "document.policy"]);
  assert.match(renderSkillText(projected), /Requires input: file, out/);
  assert.match(renderSkillText(projected), /Requires prerequisites: The document is ready for review\./);
  assert.equal(renderSkillText(projected), renderSkillText(projected));
});

test("Skill JSON projection is deterministic, valid, and keeps long content intact", () => {
  const projected = projectSkill(fixture(), "document.policy");
  const longText = "policy ".repeat(20_000);
  const withLongContent = {
    ...projected,
    steps: [{ kind: "prose", text: longText }],
  };
  const json = renderSkillJson(withLongContent);
  assert.deepEqual(JSON.parse(json), withLongContent);
  assert.equal(renderSkillJson(withLongContent), json);
});

test("Skill compilation rejects unknown command references at construction", () => {
  const product = fixture();
  const invalid = {
    broken: {
      summary: "Invalid reference.",
      steps: [{ kind: "command", commandId: "document.missing", guidance: "Cannot run." }],
    },
  };
  assert.throws(
    () => compileSkills(invalid, product.commands),
    (error) => error instanceof SkillConstructionError
      && error.issues[0]?.code === "UNKNOWN_COMMAND_REFERENCE"
      && error.issues[0]?.commandId === "document.missing",
  );
});
