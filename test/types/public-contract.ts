import * as z from "zod";
import {
  bindHandlers,
  compileProduct,
  composeCommandProjection,
  defineCommands,
  option,
  parseHelpMode,
  positional,
  projectHelp,
  projectProductSchemas,
  textOutput,
  type ProductPackageIdentity,
} from "../../src/index.js";
import {
  executeNodeCli,
  projectNodeCliExecution,
  type NodeCliTerminalAdapter,
  type StructuredUsageErrorCode,
} from "../../src/node/index.js";
import { certifyScenarios, type CertificationScenario } from "../../src/testing/index.js";

const packageMetadata: ProductPackageIdentity = {
  name: "@example/fixture",
  version: "1.0.0",
  bin: { fixture: "./dist/cli.js" },
};
const commands = defineCommands({
  "fixture.read": {
    route: ["read"],
    summary: "Read a file.",
    input: { file: positional(z.string()), format: option("--format", z.enum(["text", "json"])) },
    result: z.object({ contents: z.string() }),
  },
});
const handlers = bindHandlers(commands)({
  "fixture.read": ({ file, format }) => ({ contents: format === "json" ? JSON.stringify(file) : file }),
});
const compiled = compileProduct({
  name: "fixture",
  packageMetadata,
  commands,
  handlers,
  schemaProjectionCompleteness: "complete",
});
projectProductSchemas(compiled, "complete");

const legacyRoutes = [{ id: "legacy.help", route: ["legacy"], summary: "A legacy route.", fields: [] }] as const;
const mixedProjection = composeCommandProjection(compiled, legacyRoutes);
const helpMode = parseHelpMode(mixedProjection, ["read", "--help=full"]);
if (helpMode !== undefined) projectHelp(mixedProjection, helpMode);

const terminalAdapter: NodeCliTerminalAdapter<typeof commands> = {
  success: ({ result }) => textOutput(result.contents),
  usageFailure: ({ code }) => {
    const classified: StructuredUsageErrorCode = code;
    return textOutput(classified);
  },
};
const execution = executeNodeCli(compiled, ["read", "document.md"], { legacyRoutes });
void execution.then((result) => {
  if (result.status === "success") {
    const contents: string = result.result.contents;
    // @ts-expect-error Command results retain the result schema's output type.
    const invalid: number = result.result.contents;
    void contents;
    void invalid;
  }
  projectNodeCliExecution(result, { terminalAdapter });
});

const scenario: CertificationScenario<{ multiplier: number }, number, { value: string }, "fixture.read"> = {
  id: "typed scenario",
  commandId: "fixture.read",
  input: { value: "x" },
  expected: 1,
  requiredLanes: ["source"],
  run: ({ multiplier }, input) => input.value.length * multiplier,
};
void certifyScenarios([scenario], [{ id: "source", context: { multiplier: 1 } }], (actual, expected) => {
  if (actual !== expected) throw new Error("unexpected scenario result");
});
