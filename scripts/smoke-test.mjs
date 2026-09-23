import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function fail(message) {
  throw new Error(message);
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const tarballArgument = argument("--tarball");
if (tarballArgument === undefined) {
  fail("usage: node scripts/smoke-test.mjs --tarball <package.tgz>");
}

const tarball = path.resolve(tarballArgument);
const root = mkdtempSync(path.join(os.tmpdir(), "cli-canon-release-smoke-"));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result;
}

try {
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ private: true, type: "module" }, null, 2));

  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", `file:${tarball}`, "zod@4.6.5"]);

  const program = String.raw`
import assert from "node:assert/strict";
import * as z from "zod";
import {
  bindHandlers,
  compileProduct,
  defineCommands,
  positional,
  projectInvocation,
} from "@yohn-jp/cli-canon";
import { runNodeCli } from "@yohn-jp/cli-canon/node";
import { certifyScenarios } from "@yohn-jp/cli-canon/testing";

const commands = defineCommands({
  "smoke.echo": {
    route: ["echo"],
    summary: "Echo.",
    input: { value: positional(z.string()) },
    result: z.object({ value: z.string() }),
  },
});
const handlers = bindHandlers(commands)({
  "smoke.echo": ({ value }) => ({ value }),
});
const product = compileProduct({
  name: "smoke",
  commands,
  handlers,
  schemaProjectionCompleteness: "complete",
});

const result = await runNodeCli(product, ["echo", "ok"]);
assert.equal(result.exitCode, 0);
assert.deepEqual(JSON.parse(result.stdout), { value: "ok" });

assert.deepEqual(projectInvocation(product, "smoke.echo", { value: "ok" }), {
  state: "ready",
  commandId: "smoke.echo",
  value: { executable: "smoke", argv: ["echo", "ok"] },
});

await certifyScenarios(
  [{
    id: "packed smoke",
    commandId: "smoke.echo",
    input: "ok",
    expected: "ok",
    requiredLanes: ["packed"],
    run: (_context, input) => input,
  }],
  [{ id: "packed", context: {} }],
  (actual, expected) => assert.equal(actual, expected),
);
`;

  run(process.execPath, ["--input-type=module", "--eval", program]);
  console.log("CLI Canon packed smoke test passed.");
} finally {
  rmSync(root, { recursive: true, force: true });
}
