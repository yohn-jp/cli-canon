import * as z from "zod";
import {
  bindHandlers,
  compileProduct,
  composeCommandSources,
  defineCommands,
  defineGroups,
  positional,
  type CommandSourceId,
  type ComposedCommandTree,
  type DelegatedCommandSource,
} from "../../src/index.js";
import { executeNodeCli, runNodeCli, type NodeCliResultPresenter } from "../../src/node/index.js";

const commands = defineCommands({
  "assets.inspect": {
    route: ["assets", "inspect"],
    summary: "Inspect an asset.",
    input: { name: positional(z.string()) },
    result: z.object({ name: z.string() }),
  },
});
const product = compileProduct({
  name: "atelier",
  groups: defineGroups({ assets: { route: ["assets"], summary: "Manage assets." } }),
  commands,
  handlers: bindHandlers(commands)({
    "assets.inspect": ({ name }) => ({ name }),
  }),
});
const delegated: DelegatedCommandSource<"external"> = {
  kind: "delegated",
  id: "external",
  commands: [{ id: "assets.sync", route: ["assets", "sync"], summary: "Sync.", fields: [] }],
};
const sources = [{ kind: "canonical", id: "atelier", product }, delegated] as const;
const tree: ComposedCommandTree<CommandSourceId<typeof sources>> = composeCommandSources(sources);
tree.root.children satisfies readonly { readonly kind: "group" | "command" }[];
// @ts-expect-error Source IDs come from the declared sources.
const wrongSource: CommandSourceId<typeof sources> = "fallback";
void wrongSource;

const presenter: NodeCliResultPresenter<typeof commands> = {
  success: ({ result }) => ({ status: "success", stream: "stdout", output: result.name, exitCode: 0 }),
};
void runNodeCli(product, ["assets", "inspect", "sample"], { resultPresenter: presenter });
async function semanticBoundary(): Promise<void> {
  const outcome = await executeNodeCli(product, ["assets", "inspect", "sample"]);
  if (outcome.status === "success") {
    outcome.result.name satisfies string;
    // @ts-expect-error Semantic execution has no terminal stdout.
    void outcome.stdout;
  }
}
void semanticBoundary;
