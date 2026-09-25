import * as z from "zod";
import {
  bindHandlers,
  compileProduct,
  composeCommandSources,
  defineCommands,
  defineGroups,
  type CanonicalCommandSource,
  type CommandSource,
  type CommandSourceId,
  type CommandSourceKind,
  type CommandSourceOwner,
  type ComposedChildNode,
  type ComposedCommandNode,
  type ComposedCommandTree,
  type ComposedGroupNode,
  type ComposedRootNode,
  type DelegatedCommandDescriptor,
  type DelegatedCommandSource,
  type DelegatedGroupDescriptor,
} from "../../src/index.js";

const commands = defineCommands({
  "document.render": {
    route: ["document", "render"],
    summary: "Render a document.",
    input: {},
    result: z.object({ ok: z.boolean() }),
  },
});
const groups = defineGroups({ document: { route: ["document"], summary: "Documents." } });
// Canonical sources accept products with typed group catalogs.
const product = compileProduct({
  name: "fixture",
  commands,
  groups,
  handlers: bindHandlers(commands)({ "document.render": () => ({ ok: true }) }),
});

const canonical: CanonicalCommandSource<"canon", typeof product> = { kind: "canonical", id: "canon", product };
const group: DelegatedGroupDescriptor = { id: "external.tools", route: ["tools"], summary: "Tools." };
const command: DelegatedCommandDescriptor = {
  id: "external.tools.fetch",
  route: ["tools", "fetch"],
  summary: "Fetch.",
  visibility: "private",
  fields: [{ key: "url", kind: "positional", required: true }],
};
const delegated: DelegatedCommandSource<"external"> = {
  kind: "delegated",
  id: "external",
  groups: [group],
  commands: [command],
};

const sources = [canonical, delegated] as const;
const composed = composeCommandSources(sources);
composed satisfies ComposedCommandTree<"canon" | "external">;
const sourceId: CommandSourceId<typeof sources> = "external";
void sourceId;
// @ts-expect-error source IDs are inferred from the declared sources.
const unknownSourceId: CommandSourceId<typeof sources> = "other";
void unknownSourceId;

const root: ComposedRootNode<"canon" | "external"> = composed.root;
const owner: CommandSourceOwner<"canon" | "external"> | undefined = composed.sources[0];
const kind: CommandSourceKind | undefined = owner?.kind;
void kind;

function visit(node: ComposedChildNode<"canon" | "external">): void {
  if (node.kind === "group") {
    const groupNode: ComposedGroupNode<"canon" | "external"> = node;
    groupNode.children.forEach(visit);
    // @ts-expect-error groups are non-executable and carry no fields.
    void groupNode.fields;
    return;
  }
  const commandNode: ComposedCommandNode<"canon" | "external"> = node;
  commandNode.owner.sourceId satisfies "canon" | "external";
  commandNode.fields satisfies readonly { readonly key: string }[];
}
root.children.forEach(visit);

// @ts-expect-error delegated command descriptors must declare their structural fields.
const missingFields: DelegatedCommandDescriptor = { id: "x", route: ["x"], summary: "X." };
void missingFields;
// @ts-expect-error delegated group descriptors cannot declare fields.
const executableGroup: DelegatedGroupDescriptor = { id: "g", route: ["g"], summary: "G.", fields: [] };
void executableGroup;
// @ts-expect-error source kinds are limited to canonical and delegated.
const pluginSource: CommandSource = { kind: "plugin", id: "p", commands: [] };
void pluginSource;
