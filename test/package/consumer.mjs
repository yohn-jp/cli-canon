import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

const root = process.cwd();
const packDir = mkdtempSync(path.join(os.tmpdir(), "cli-canon-pack-"));
const pack = run("pnpm", ["pack", "--pack-destination", packDir])
  .stdout.trim()
  .split(/\r?\n/u)
  .at(-1);
assert.ok(pack);
const tarball = path.resolve(packDir, pack);
const consumer = mkdtempSync(path.join(os.tmpdir(), "cli-canon-consumer-"));

writeFileSync(
  path.join(consumer, "package.json"),
  JSON.stringify(
    {
      type: "module",
      private: true,
      dependencies: {
        "@yohn-jp/cli-canon": `file:${tarball}`,
        zod: "4.6.5",
      },
      devDependencies: { typescript: "6.0.3" },
    },
    null,
    2,
  ),
);

writeFileSync(
  path.join(consumer, "consumer.ts"),
  `import * as z from "zod";
import { defineCommands, bindHandlers, compileProduct, positional } from "@yohn-jp/cli-canon";
import { runNodeCli } from "@yohn-jp/cli-canon/node";
const commands = defineCommands({ echo: { route: ["echo"], summary: "Echo", input: { value: positional(z.string()) }, result: z.object({ value: z.string() }) } });
const handlers = bindHandlers(commands)({ echo: ({ value }) => ({ value }) });
const product = compileProduct({ name: "consumer", commands, handlers });
void runNodeCli(product, ["echo", "typed"]);
`,
);

writeFileSync(
  path.join(consumer, "consumer.mjs"),
  `import * as z from "zod";
import { defineCommands, bindHandlers, compileProduct, positional } from "@yohn-jp/cli-canon";
import { runNodeCli } from "@yohn-jp/cli-canon/node";
const commands = defineCommands({ echo: { route: ["echo"], summary: "Echo", input: { value: positional(z.string()) }, result: z.object({ value: z.string() }) } });
const handlers = bindHandlers(commands)({ echo: ({ value }) => ({ value }) });
const product = compileProduct({ name: "consumer", commands, handlers });
const result = await runNodeCli(product, ["echo", "packed"]);
if (result.exitCode !== 0 || JSON.parse(result.stdout).value !== "packed") process.exit(1);
`,
);

writeFileSync(
  path.join(consumer, "tsconfig.json"),
  JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noEmit: true,
      },
      include: ["consumer.ts"],
    },
    null,
    2,
  ),
);

run("pnpm", ["install", "--frozen-lockfile=false"], { cwd: consumer });
run("pnpm", ["exec", "tsc", "-p", "tsconfig.json"], { cwd: consumer });
run(process.execPath, ["consumer.mjs"], { cwd: consumer });
console.log("packed consumer verified");
