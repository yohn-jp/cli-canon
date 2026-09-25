import * as z from "zod";
import {
  bindHandlers,
  compileProduct,
  defineCommands,
  defineGroups,
  executeCanonicalCommand,
  positional,
  type CanonicalExecutionOutcome,
  type CanonicalFailureKind,
  type CanonicalRuntimeProduct,
  type CanonicalUsageFailureCode,
  type CliResult,
} from "../../src/index.js";

const commands = defineCommands({
  "math.double": {
    route: ["math", "double"],
    summary: "Double an integer.",
    input: { value: positional(z.coerce.number().int()) },
    result: z.object({ value: z.number().int() }),
  },
  "text.echo": {
    route: ["text", "echo"],
    summary: "Echo text.",
    input: { text: positional(z.string()) },
    result: z.object({ text: z.string() }),
  },
});
const groups = defineGroups({ math: { route: ["math"], summary: "Math." } });
const handlers = bindHandlers(commands)({
  "math.double": ({ value }) => ({ value: value * 2 }),
  "text.echo": ({ text }) => ({ text }),
});
const product = compileProduct({ name: "fixture", commands, groups, handlers });

const runtimeProduct: CanonicalRuntimeProduct<typeof commands> = product;
void runtimeProduct;

async function contract(): Promise<void> {
  const outcome = await executeCanonicalCommand(product, { route: ["math", "double"], input: { value: "2" } });
  if (outcome.status === "success") {
    if (outcome.commandId === "math.double") {
      const value: number = outcome.result.value;
      const route: readonly ["math", "double"] = outcome.route;
      void value;
      void route;
      // @ts-expect-error result is narrowed by command identity
      void outcome.result.text;
    } else {
      const text: string = outcome.result.text;
      void text;
    }
    // @ts-expect-error semantic outcomes carry no terminal serialization
    void outcome.stdout;
    return;
  }
  const kind: CanonicalFailureKind = outcome.failureKind;
  void kind;
  if (outcome.failureKind === "usage") {
    const code: CanonicalUsageFailureCode = outcome.usageFailure.code;
    void code;
  } else if (outcome.failureKind === "validation") {
    const field: string = outcome.field;
    const id: "math.double" | "text.echo" = outcome.commandId;
    void field;
    void id;
  } else {
    const error: unknown = outcome.error;
    void error;
  }
}
void contract;

// @ts-expect-error semantic outcomes are independent of CliResult
const notCliResult: CliResult = {} as CanonicalExecutionOutcome<typeof commands>;
void notCliResult;
