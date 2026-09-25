import * as z from "zod";
import { defineCommands } from "../../src/command/commands.js";
import { compileProduct } from "../../src/command/compiler.js";
import { bindHandlers } from "../../src/command/handlers.js";
import { flag, option, positional } from "../../src/command/fields.js";
import type { CommandId } from "../../src/command/model.js";
import { defineSkills, type SkillCatalog, type SkillId } from "../../src/skill/model.js";
import { projectSkill } from "../../src/skill/projection.js";

const commands = defineCommands({
  "document.render": {
    route: ["document", "render"],
    summary: "Render a document.",
    input: {
      file: positional(z.string()),
      out: option("--out", z.string(), { required: true }),
      draft: flag("--draft"),
    },
    result: z.object({ writtenFile: z.string() }),
  },
});

type Commands = CommandId<typeof commands>;
const skills = defineSkills({
  "document.workflow": {
    summary: "Render a document for review.",
    steps: [
      { kind: "prose", text: "Choose the source document and destination." },
      {
        kind: "command",
        commandId: "document.render",
        guidance: "Render the selected document.",
        prerequisites: ["A destination has been selected."],
      },
    ],
  },
});

type Id = SkillId<typeof skills>;
const validId: Id = "document.workflow";
void validId;
// @ts-expect-error Skill IDs are inferred from declarations.
const invalidId: Id = "document.missing";
void invalidId;

const checkedSkills: SkillCatalog<Commands> = skills;
void checkedSkills;
const handlers = bindHandlers(commands)({
  "document.render": ({ out }) => ({ writtenFile: out }),
});
const compiledProduct = compileProduct({ name: "fixture", commands, handlers, skills });
compiledProduct.skills[0]?.id satisfies SkillId<typeof skills> | undefined;
const projected = projectSkill(compiledProduct, "document.workflow");
const projectedCommand = projected.steps[1];
if (projectedCommand?.kind === "command") {
  projectedCommand.commandId satisfies "document.render";
}

const badSkills = defineSkills({
  broken: {
    summary: "Invalid reference.",
    steps: [{ kind: "command", commandId: "document.missing", guidance: "Cannot run." }],
  },
});
// @ts-expect-error Command step IDs must belong to the Command Canon.
const invalidReferences: SkillCatalog<Commands> = badSkills;
void invalidReferences;
// @ts-expect-error compileProduct rejects Skill references outside the command catalog.
compileProduct({ name: "fixture", commands, handlers, skills: badSkills });

const proseOnlySkills = defineSkills({
  guide: { summary: "Guidance without a command.", steps: [{ kind: "prose", text: "Read this first." }] },
});
const proseOnlyId: SkillId<typeof proseOnlySkills> = "guide";
void proseOnlyId;

const delegatedSkills = defineSkills({
  workflow: { summary: "Delegate within the Skill catalog.", steps: [{ kind: "delegate", skillId: "details" }] },
  details: { summary: "Detailed guidance.", steps: [{ kind: "prose", text: "Review the existing result." }] },
});
const delegatedProduct = compileProduct({ name: "fixture", commands, handlers, skills: delegatedSkills });
const delegatedStep = delegatedProduct.skills[0]?.steps[0];
if (delegatedStep?.kind === "delegate") {
  delegatedStep.skillId satisfies SkillId<typeof delegatedSkills>;
}

const badDelegation = defineSkills({
  workflow: { summary: "Invalid delegation.", steps: [{ kind: "delegate", skillId: "missing" }] },
});
// @ts-expect-error compileProduct restricts delegated Skill IDs to the declared catalog.
compileProduct({ name: "fixture", commands, handlers, skills: badDelegation });
