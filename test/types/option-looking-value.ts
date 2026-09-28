import * as z from "zod";
import { bindHandlers, compileProduct, defineCommands, flag, option } from "../../src/index.js";
import { executeNodeCli, type StructuredUsageFailure } from "../../src/node/index.js";

const commands = defineCommands({
  "repo.show": {
    route: ["repo", "show"],
    summary: "Show a repository.",
    input: {
      repository: option("--repository", z.string(), { required: true, optionLookingValuePolicy: "reject" }),
      label: option("--label", z.string(), { optionLookingValuePolicy: "consume" }),
      draft: flag("--draft"),
    },
    result: z.object({ repository: z.string() }),
  },
});

const repository = commands["repo.show"].input.repository;
repository.optionLookingValuePolicy satisfies "reject";
// @ts-expect-error the declared reject policy is preserved in the field type.
repository.optionLookingValuePolicy satisfies "consume";
commands["repo.show"].input.label.optionLookingValuePolicy satisfies "consume";

// @ts-expect-error option-looking value policies are limited to consume and reject.
option("--other", z.string(), { optionLookingValuePolicy: "split" });

const product = compileProduct({
  name: "fixture",
  commands,
  handlers: bindHandlers(commands)({
    "repo.show": ({ repository: value, label, draft }) => {
      value satisfies string;
      label satisfies string | undefined;
      draft satisfies boolean;
      return { repository: value };
    },
  }),
});

export async function rejectPolicyExecution(): Promise<void> {
  const execution = await executeNodeCli(product, ["repo", "show", "--repository", "--draft"]);
  if (execution.status === "failure" && execution.failureKind === "usage") {
    const failure: StructuredUsageFailure = execution.usageFailure;
    failure.code satisfies StructuredUsageFailure["code"];
    failure.option satisfies string | undefined;
  }
}
