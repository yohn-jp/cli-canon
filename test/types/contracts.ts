import * as z from "zod";
import {
  bindHandlers,
  compileProduct,
  defineCommands,
  flag,
  option,
  positional,
  rawArgs,
  type CommandId,
} from "../../src/index.js";

const commands = defineCommands({
  "document.render": {
    route: ["document", "render"],
    summary: "Render a document.",
    input: {
      file: positional(z.string().min(1)),
      out: option("--out", z.string().min(1), { aliases: ["-o"], required: true }),
      json: flag("--json", { placement: "anywhere" }),
      tag: option("--tag", z.string(), { repeatable: true }),
      args: rawArgs(),
    },
    result: z.object({ writtenFile: z.string() }),
  },
});

type Id = CommandId<typeof commands>;
const validId: Id = "document.render";
void validId;
// @ts-expect-error command IDs are inferred from the declaration graph.
const invalidId: Id = "document.missing";
void invalidId;

const handlers = bindHandlers(commands)({
  "document.render": async ({ file, out, json, tag, args }) => {
    file satisfies string;
    out satisfies string;
    json satisfies boolean;
    tag satisfies readonly string[];
    args satisfies readonly string[];
    return { writtenFile: out };
  },
});

compileProduct({ name: "fixture", commands, handlers });

bindHandlers(commands)({
  // @ts-expect-error result contract is checked per command.
  "document.render": async () => ({ writtenFile: 123 }),
});

bindHandlers(commands)({
  "document.render": async () => ({ writtenFile: "ok" }),
  // @ts-expect-error unknown handlers are not accepted.
  "document.missing": async () => ({ writtenFile: "no" }),
});
