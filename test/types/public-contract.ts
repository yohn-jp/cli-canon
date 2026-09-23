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
const compiled = compileProduct({ name: "fixture", packageMetadata, commands, handlers });
projectProductSchemas(compiled, "complete");

const scenario: CertificationScenario<{ input: string }, number> = {
  id: "typed scenario",
  expected: 1,
  run: ({ input }) => input.length,
};
void certifyScenarios([scenario], [{ id: "source", context: { input: "x" } }], (actual, expected) => {
  if (actual !== expected) throw new Error("unexpected scenario result");
});
