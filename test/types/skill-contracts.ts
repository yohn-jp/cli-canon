import * as z from "zod";
import { defineCommands } from "../../src/command/commands.js";
import { flag, option, positional } from "../../src/command/fields.js";
import type { CommandId } from "../../src/command/model.js";
import { defineSkills, type SkillCatalog, type SkillId } from "../../src/skill/model.js";

const commands = defineCommands({
  "document.render": {
    route: ["document", "render"],
    summary: "Render a document.",
    input: {
      file: positional(z.string()),
      out: option("--out", z.string(), { required: true }),
      json: flag("--json"),
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

const badSkills = defineSkills({
  broken: {
    summary: "Invalid reference.",
    steps: [{ kind: "command", commandId: "document.missing", guidance: "Cannot run." }],
  },
});
// @ts-expect-error Command step IDs must belong to the Command Canon.
const invalidReferences: SkillCatalog<Commands> = badSkills;
void invalidReferences;

const proseOnlySkills = defineSkills({
  guide: { summary: "Guidance without a command.", steps: [{ kind: "prose", text: "Read this first." }] },
});
const proseOnlyId: SkillId<typeof proseOnlySkills> = "guide";
void proseOnlyId;
