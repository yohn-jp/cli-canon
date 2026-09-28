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
import { bindHandlers, compileProduct, defineCommands, flag, option } from "@yohn-jp/cli-canon";
import { executeNodeCli, runNodeCli } from "@yohn-jp/cli-canon/node";

const commands = defineCommands({
  "repo.show": {
    route: ["repo", "show"],
    summary: "Show a repository.",
    input: {
      repository: option("--repository", z.string(), { required: true, optionLookingValuePolicy: "reject" }),
      label: option("--label", z.string()),
      draft: flag("--draft"),
    },
    result: z.object({ repository: z.string(), label: z.string().optional(), draft: z.boolean() }),
  },
});
const product = compileProduct({
  name: "packed",
  commands,
  handlers: bindHandlers(commands)({
    "repo.show": ({ repository, label, draft }) => ({ repository, ...(label === undefined ? {} : { label }), draft }),
  }),
});

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const rejected = await executeNodeCli(product, ["repo", "show", "--repository", "--draft"]);
check(
  rejected.status === "failure" &&
    rejected.failureKind === "usage" &&
    rejected.usageFailure.code === "missing-option-value" &&
    rejected.usageFailure.commandId === "repo.show" &&
    rejected.usageFailure.option === "--repository",
  "reject must report a structured missing option value",
);

const machine = await runNodeCli(product, ["repo", "show", "--repository", "--json"]);
check(machine.exitCode === 2, "reject with --json must fail as usage");
const document = JSON.parse(machine.stderr) as { error: { code: string; commandId: string } };
check(document.error.code === "missing-option-value", "--json must keep machine presentation");
check(document.error.commandId === "repo.show", "machine usage failure must name the command");

const help = await executeNodeCli(product, ["repo", "show", "--repository", "--help"]);
check(help.status === "help", "--help after a reject-policy option must remain help");

const attached = await runNodeCli(product, ["repo", "show", "--repository=--draft"]);
check(attached.exitCode === 0, "attached values are explicit");
check(JSON.parse(attached.stdout).repository === "--draft", "attached value must bind verbatim");

const negative = await runNodeCli(product, ["repo", "show", "--repository", "-1"]);
check(JSON.parse(negative.stdout).repository === "-1", "negative numbers remain values");

const consumed = await runNodeCli(product, ["repo", "show", "--repository", "acme", "--label", "--draft"]);
check(JSON.parse(consumed.stdout).label === "--draft", "consume remains the default policy");
`;

test("packed package declares and executes optionLookingValuePolicy reject without a consumer tokenizer", () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "cli-canon-option-looking-"));
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
