import * as z from "zod";
import {
  bindHandlers,
  compileProduct,
  defineCommands,
  positional,
  projectProductSchemas,
  type ProductPackageIdentity,
} from "../../src/index.js";
import {
  certifyScenarios,
  type CertificationScenario,
} from "../../src/testing/index.js";

const packageMetadata: ProductPackageIdentity = {
  name: "@example/fixture",
  version: "1.0.0",
  bin: { fixture: "./dist/cli.js" },
};
const commands = defineCommands({
  "fixture.read": {
    route: ["read"],
    summary: "Read a file.",
    input: { file: positional(z.string()) },
    result: z.object({ contents: z.string() }),
  },
});
const handlers = bindHandlers(commands)({
  "fixture.read": ({ file }) => ({ contents: file }),
});
const compiled = compileProduct({ name: "fixture", packageMetadata, commands, handlers, schemaProjectionCompleteness: "complete" });
projectProductSchemas(compiled, "complete");

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
