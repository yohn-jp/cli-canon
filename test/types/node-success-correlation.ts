import * as z from "zod";
import { bindHandlers, compileProduct, defineCommands, textOutput } from "../../src/index.js";
import {
  executeNodeCli,
  projectNodeCliExecution,
  runNodeCli,
  type NodeCliResultPresenter,
  type NodeCliSuccess,
} from "../../src/node/index.js";

// Two commands whose results are structurally different.
const commands = defineCommands({
  "catalog.list": {
    route: ["list"],
    summary: "List entries.",
    input: {},
    result: z.object({ entries: z.array(z.string()) }),
  },
  "catalog.count": {
    route: ["count"],
    summary: "Count entries.",
    input: {},
    result: z.object({ total: z.number() }),
  },
});
const product = compileProduct({
  name: "catalog",
  commands,
  handlers: bindHandlers(commands)({
    "catalog.list": () => ({ entries: ["a"] }),
    "catalog.count": () => ({ total: 1 }),
  }),
});

function describe(success: NodeCliSuccess<typeof commands>): string {
  if (success.commandId === "catalog.list") {
    const entries: readonly string[] = success.result.entries;
    // @ts-expect-error A list success never carries the count result.
    void success.result.total;
    return entries.join(",");
  }
  success.commandId satisfies "catalog.count";
  const total: number = success.result.total;
  // @ts-expect-error A count success never carries the list result.
  void success.result.entries;
  return String(total);
}

const resultPresenter: NodeCliResultPresenter<typeof commands> = {
  success: (execution) => {
    switch (execution.commandId) {
      case "catalog.list":
        return textOutput(execution.result.entries.join("\n"));
      case "catalog.count":
        return textOutput(String(execution.result.total));
    }
  },
};

void executeNodeCli(product, ["list"]).then((execution) => {
  if (execution.status === "success") void describe(execution);
  projectNodeCliExecution(execution, { resultPresenter });
});
void runNodeCli(product, ["count"], { resultPresenter });
