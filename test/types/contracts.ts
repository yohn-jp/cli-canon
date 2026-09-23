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
  type CliIO,
  type DomainErrorAdapter,
  type CliOutcome,
  jsonOutput,
} from "../../src/index.js";
import { runNodeCli } from "../../src/node/index.js";

const commands = defineCommands({
  "document.render": {
    route: ["document", "render"],
    summary: "Render a document.",
    input: {
      file: positional(z.string().min(1)),
      target: positional(z.string(), { required: false, description: "Optional destination." }),
      out: option("--out", z.string().min(1), { aliases: ["-o"], required: true }),
      format: option("--format", z.enum(["full", "json"]), { valueArity: "optional" }),
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
  "document.render": async ({ file, target, out, format, json, tag, args }) => {
    file satisfies string;
    target satisfies string | undefined;
    // @ts-expect-error optional positionals can be absent.
    target.toUpperCase();
    out satisfies string;
    format satisfies "full" | "json" | undefined;
    json satisfies boolean;
    tag satisfies readonly string[];
    args satisfies readonly string[];
    return { writtenFile: out };
  },
});

compileProduct({ name: "fixture", commands, handlers });
interface ProductDomainError {
  readonly code: "DOCUMENT_LOCKED";
  readonly message: string;
}

const domainErrorAdapter: DomainErrorAdapter<ProductDomainError> = {
  is: (error): error is ProductDomainError => typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "DOCUMENT_LOCKED"
    && "message" in error
    && typeof error.message === "string",
  map: (error) => ({ exitCode: 8, stream: "stderr", output: `${error.code}: ${error.message}\n` }),
};
void runNodeCli(compileProduct({ name: "fixture", commands, handlers }), [], { domainErrorAdapter });

const output: CliOutcome = jsonOutput({ ok: true }, { maxBytes: 64 });
const cliIO: CliIO = { writeStdout: (_value) => {}, writeStderr: (_value) => {} };
void output;
void cliIO;

const invalidDomainErrorAdapter: DomainErrorAdapter<ProductDomainError> = {
  is: domainErrorAdapter.is,
  // @ts-expect-error product error mappings must include a numeric process exit code.
  map: () => ({ exitCode: "failure", stream: "stderr", output: "failed\n" }),
};
void invalidDomainErrorAdapter;


bindHandlers(commands)({
  // @ts-expect-error result contract is checked per command.
  "document.render": async () => ({ writtenFile: 123 }),
});

bindHandlers(commands)({
  "document.render": async () => ({ writtenFile: "ok" }),
  // @ts-expect-error unknown handlers are not accepted.
  "document.missing": async () => ({ writtenFile: "no" }),
});
