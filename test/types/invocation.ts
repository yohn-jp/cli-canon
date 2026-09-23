import * as z from "zod";
import {
  bindHandlers,
  compileProduct,
  defineCommands,
  defineSkills,
  flag,
  option,
  positional,
  projectInvocation,
  rawArgs,
  skillCommand,
  type InvocationBindings,
} from "../../src/index.js";

const commands = defineCommands({
  "deploy.run": {
    route: ["deploy", "run"],
    summary: "Run deployment.",
    input: {
      target: positional(z.string()),
      out: option("--out", z.string(), { required: true }),
      format: option("--format", z.string(), { valueArity: "optional" }),
      json: flag("--json"),
      tag: option("--tag", z.string(), { repeatable: true }),
      args: rawArgs(),
    },
    result: z.object({ ok: z.boolean() }),
  },
});

type Bindings = InvocationBindings<(typeof commands)["deploy.run"]>;
const bindings: Bindings = {
  target: "input",
  out: "out.html",
  format: true,
  json: true,
  tag: ["a", "b"],
  args: ["--literal"],
};
void bindings;

// @ts-expect-error unknown bindings are not part of the command input.
const unknownBinding: Bindings = { missing: "value" };
void unknownBinding;

// @ts-expect-error flags require boolean bindings.
const invalidFlagBinding: Bindings = { json: "yes" };
void invalidFlagBinding;

// @ts-expect-error required-value options cannot use the valueless marker.
const invalidRequiredValue: Bindings = { out: true };
void invalidRequiredValue;

const handlers = bindHandlers(commands)({ "deploy.run": () => ({ ok: true }) });
const product = compileProduct({ name: "fixture", commands, handlers });
const invocation = projectInvocation(product, "deploy.run", bindings);
void invocation;

const skills = defineSkills({
  deployment: {
    summary: "Deploy.",
    steps: [
      skillCommand(commands, "deploy.run", {
        guidance: "Run deployment.",
        bindings: { target: "input", out: "out.html", json: true },
      }),
    ],
  },
});
compileProduct({ name: "fixture", commands, handlers, skills });

skillCommand(commands, "deploy.run", {
  guidance: "Invalid.",
  // @ts-expect-error Skill command bindings are typed from the referenced command.
  bindings: { missing: "value" },
});
