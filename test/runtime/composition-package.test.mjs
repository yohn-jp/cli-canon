import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  return result;
}

const consumerSource = `import * as z from "zod";
import {
  CanonConstructionError,
  bindHandlers,
  compileProduct,
  composeCommandSources,
  defineCommands,
  defineGroups,
  type CanonicalCommandSource,
  type CommandSource,
  type CommandSourceId,
  type ComposedChildNode,
  type ComposedCommandTree,
  type DelegatedCommandSource,
  type DelegatedGroupDescriptor,
} from "@yohn-jp/cli-canon";

const commands = defineCommands({
  "document.render": {
    route: ["document", "render"],
    summary: "Render a document.",
    input: {},
    result: z.object({ ok: z.boolean() }),
  },
});
const groups = defineGroups({ document: { route: ["document"], summary: "Documents." } });
const product = compileProduct({
  name: "packed",
  commands,
  groups,
  handlers: bindHandlers(commands)({ "document.render": () => ({ ok: true }) }),
});
const canonical: CanonicalCommandSource<"canon", typeof product> = { kind: "canonical", id: "canon", product };
const delegated: DelegatedCommandSource<"external"> = {
  kind: "delegated",
  id: "external",
  commands: [{ id: "external.convert", route: ["document", "convert"], summary: "Convert.", fields: [] }],
};
const sources = [canonical, delegated] as const;
const composed: ComposedCommandTree<CommandSourceId<typeof sources>> = composeCommandSources(sources);
// @ts-expect-error source IDs are inferred from the declared sources.
const unknownSource: CommandSourceId<typeof sources> = "other";
void unknownSource;
// @ts-expect-error delegated group descriptors cannot declare fields.
const executableGroup: DelegatedGroupDescriptor = { id: "g", route: ["g"], summary: "G.", fields: [] };
void executableGroup;
// @ts-expect-error source kinds are limited to canonical and delegated.
const pluginSource: CommandSource = { kind: "plugin", id: "p", commands: [] };
void pluginSource;

function owners(nodes: readonly ComposedChildNode<"canon" | "external">[]): string[] {
  return nodes.flatMap((node) =>
    node.kind === "group" ? owners(node.children) : [node.id + "@" + node.owner.sourceId],
  );
}
if (owners(composed.root.children).join(",") !== "external.convert@external,document.render@canon") {
  throw new Error("unexpected packed composition");
}
try {
  composeCommandSources([canonical, { ...delegated, commands: [{ ...delegated.commands[0]!, route: ["document", "render"] }] }]);
  throw new Error("duplicate ownership must fail");
} catch (error) {
  if (!(error instanceof CanonConstructionError) || error.issues[0]?.code !== "DUPLICATE_ROUTE") throw error;
}
`;

test("packed package exposes generic command-source composition types and runtime", () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "cli-canon-composition-"));
  try {
    const packDir = path.join(workspace, "pack");
    const consumer = path.join(workspace, "consumer");
    mkdirSync(packDir);
    // `pnpm test` builds dist first; skip prepack so parallel runtime tests never observe a rebuild.
    run("pnpm", ["--config.ignore-scripts=true", "pack", "--pack-destination", packDir], { cwd: root });
    const archives = readdirSync(packDir).filter((file) => file.endsWith(".tgz"));
    assert.equal(archives.length, 1);

    const installed = path.join(consumer, "node_modules", "@yohn-jp", "cli-canon");
    mkdirSync(installed, { recursive: true });
    run("tar", ["-xzf", path.join(packDir, archives[0]), "-C", installed, "--strip-components=1"]);
    for (const dependency of ["zod", "commander"]) {
      symlinkSync(path.join(root, "node_modules", dependency), path.join(consumer, "node_modules", dependency), "dir");
    }
    writeFileSync(path.join(consumer, "package.json"), JSON.stringify({ type: "module", private: true }));
    writeFileSync(
      path.join(consumer, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          exactOptionalPropertyTypes: true,
          noUncheckedIndexedAccess: true,
          skipLibCheck: false,
          outDir: "out",
        },
        include: ["consumer.ts"],
      }),
    );
    writeFileSync(path.join(consumer, "consumer.ts"), consumerSource);

    run(process.execPath, [path.join(root, "node_modules", "typescript", "bin", "tsc"), "-p", consumer]);
    run(process.execPath, [path.join(consumer, "out", "consumer.js")], { cwd: consumer });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
