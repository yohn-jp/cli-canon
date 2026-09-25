import * as z from "zod";
import {
  bindHandlers,
  compileProduct,
  defineCommands,
  defineGroups,
  option,
  positional,
  type CommandId,
  type CommandInput,
  type CommandResultOutput,
  type CompiledProduct,
  type CommandTreeChildNode,
  type CommandTreeCommandNode,
  type CommandTreeGroupNode,
  type CommandTreeNode,
  type CommandTreeNodeKind,
  type CommandTreeRootNode,
  type GroupCatalog,
  type GroupDefinition,
  type GroupId,
} from "../../src/index.js";

const commands = defineCommands({
  "document.render": {
    route: ["document", "render"],
    summary: "Render a document.",
    input: { file: positional(z.string()), out: option("--out", z.string(), { required: true }) },
    result: z.object({ writtenFile: z.string() }),
  },
});

const groups = defineGroups({
  document: {
    route: ["document"],
    summary: "Work with documents.",
    description: "Commands that read and write documents.",
    examples: ["fixture document render input.md --out out.md"],
    visibility: "public",
  },
  "document.internal": { route: ["document", "internal"], summary: "Internal document tools.", visibility: "private" },
});

type Commands = typeof commands;
type Groups = typeof groups;

// Existing command inference is preserved alongside groups.
const commandId: CommandId<Commands> = "document.render";
const input: CommandInput<Commands["document.render"]> = { file: "a.md", out: "b.md" };
const result: CommandResultOutput<Commands["document.render"]> = { writtenFile: "b.md" };
void commandId;
void input;
void result;
// @ts-expect-error command IDs remain inferred from command declarations only.
const groupAsCommandId: CommandId<Commands> = "document";
void groupAsCommandId;

// Group IDs and routes are inferred from group declarations.
const groupId: GroupId<Groups> = "document.internal";
const groupRoute: readonly ["document"] = groups.document.route;
const groupDefinition: GroupDefinition = groups.document;
const groupCatalog: GroupCatalog = groups;
void groupId;
void groupRoute;
void groupDefinition;
void groupCatalog;
// @ts-expect-error group IDs are inferred from the declaration keys.
const unknownGroupId: GroupId<Groups> = "document.missing";
void unknownGroupId;

// Root, group, and command node kinds are explicit.
const commandNode: CommandTreeCommandNode<Commands, "document.render"> = {
  kind: "command",
  id: "document.render",
  route: commands["document.render"].route,
  definition: commands["document.render"],
};
const groupNode: CommandTreeGroupNode<Groups, Commands, "document"> = {
  kind: "group",
  id: "document",
  route: groups.document.route,
  definition: groups.document,
  children: [commandNode],
};
const root: CommandTreeRootNode<Groups, Commands> = { kind: "root", children: [groupNode] };
const nodes: readonly CommandTreeNode<Groups, Commands>[] = [root, groupNode, commandNode];
const kinds: readonly CommandTreeNodeKind[] = nodes.map((node) => node.kind);
void kinds;

function describe(node: CommandTreeNode<Groups, Commands>): string {
  switch (node.kind) {
    case "root":
      return String(node.children.length);
    case "group":
      return node.definition.summary;
    case "command":
      return node.definition.summary;
  }
}
void describe;

// @ts-expect-error node kinds are a closed vocabulary.
const invalidKind: CommandTreeNodeKind = "alias";
void invalidKind;

// @ts-expect-error command nodes reference declared command IDs only.
const invalidCommandLeaf: CommandTreeChildNode<Groups, Commands> = {
  kind: "command",
  id: "document",
  route: groups.document.route,
  definition: commands["document.render"],
};
void invalidCommandLeaf;

// @ts-expect-error group nodes reference declared group IDs only.
const invalidGroupNode: CommandTreeChildNode<Groups, Commands> = {
  kind: "group",
  id: "document.render",
  route: commands["document.render"].route,
  definition: groups.document,
  children: [],
};
void invalidGroupNode;

// @ts-expect-error command nodes are leaves.
const commandWithChildren: CommandTreeCommandNode<Commands, "document.render"> = { ...commandNode, children: [] };
void commandWithChildren;

// @ts-expect-error the root is not addressed by a route.
const routedRoot: CommandTreeRootNode<Groups, Commands> = { kind: "root", route: ["document"], children: [] };
void routedRoot;

// Invalid group declarations.
defineGroups({
  // @ts-expect-error group routes require at least one token.
  empty: { route: [], summary: "Empty route." },
});
defineGroups({
  // @ts-expect-error groups require a summary.
  unsummarized: { route: ["document"] },
});
defineGroups({
  // @ts-expect-error group visibility uses the command visibility vocabulary.
  hidden: { route: ["document"], summary: "Hidden.", visibility: "hidden" },
});
defineGroups({
  // @ts-expect-error groups are non-executable and declare no input.
  executable: { route: ["document"], summary: "Executable.", input: {} },
});
defineGroups({
  // @ts-expect-error groups are non-executable and declare no result.
  resulting: { route: ["document"], summary: "Resulting.", result: z.object({}) },
});
defineGroups({
  // @ts-expect-error group examples are strings.
  badExamples: { route: ["document"], summary: "Bad examples.", examples: [1] },
});

// compileProduct exposes the canonical tree typed by the declared groups and commands.
const handlers = bindHandlers(commands)({ "document.render": ({ out }) => ({ writtenFile: out }) });
const product = compileProduct({ name: "fixture", commands, handlers, groups });
const tree: CommandTreeRootNode<Groups, Commands> = product.tree;
void tree;
const compatibleProduct: CompiledProduct<Commands> = product;
void compatibleProduct;
for (const node of product.tree.children) {
  if (node.kind === "group") {
    node.id satisfies GroupId<Groups>;
    node.definition.summary satisfies string;
  } else {
    node.id satisfies CommandId<Commands>;
    node.definition.input.file satisfies Commands["document.render"]["input"]["file"];
  }
}
// @ts-expect-error the compiled tree is immutable.
product.tree.children.push(groupNode);
// @ts-expect-error the compiled tree root is immutable.
product.tree.kind = "group";
// The flat commands view keeps its existing element contract.
product.commands[0]?.fields satisfies readonly unknown[] | undefined;

// Products without groups expose only command leaves under the root.
const ungrouped = compileProduct({ name: "fixture", commands, handlers });
for (const node of ungrouped.tree.children) {
  node.kind satisfies "command";
  // @ts-expect-error products without groups have no group nodes.
  void (node.kind === "group");
}
// @ts-expect-error group declarations must satisfy GroupDefinition.
compileProduct({ name: "fixture", commands, handlers, groups: { broken: { route: [], summary: "Broken." } } });
