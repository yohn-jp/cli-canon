import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const typesDirectory = path.join(root, "test", "types");
const tsc = createRequire(path.join(root, "package.json")).resolve("typescript/bin/tsc");

function runTsc(args, cwd = root) {
  const result = spawnSync(process.execPath, [tsc, ...args], { cwd, encoding: "utf8" });
  assert.equal(result.error, undefined);
  return result;
}

/** Every intended type fixture is a `.ts` file directly under test/types. */
const intendedFixtures = readdirSync(typesDirectory)
  .filter((file) => file.endsWith(".ts"))
  .sort();

test("the type certification program uses TypeScript 6.0.3", () => {
  const version = runTsc(["--version"]);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout, "Version 6.0.3\n");
});

test("TypeScript lists every intended test/types fixture in the type certification program", () => {
  assert.deepEqual(intendedFixtures, [
    "command-tree.ts",
    "composition-certification.ts",
    "composition.ts",
    "contracts.ts",
    "invocation.ts",
    "node-success-correlation.ts",
    "path-canon.ts",
    "public-contract.ts",
    "runtime.ts",
    "shell-context.ts",
    "skill-contracts.ts",
  ]);
  const listed = runTsc(["-p", path.join(typesDirectory, "tsconfig.json"), "--listFilesOnly"]);
  assert.equal(listed.status, 0, listed.stderr);
  const files = new Set(listed.stdout.split(/\r?\n/u).filter((line) => line !== ""));
  for (const fixture of intendedFixtures) {
    assert.ok(files.has(path.join(typesDirectory, fixture)), `${fixture} must be compiled by test:types`);
  }
  assert.ok(files.has(path.join(root, "src", "index.ts")), "production sources stay in the type program");
  assert.ok(files.has(path.join(root, "src", "node", "index.ts")), "Node sources stay in the type program");
});

test("the source multi-command Node discriminant proof passes and fails when a negative assertion is removed", () => {
  const fixture = readFileSync(path.join(typesDirectory, "node-success-correlation.ts"), "utf8").replaceAll(
    '"../../src/',
    `"${path.join(root, "src")}/`,
  );
  const listNegative = "    // @ts-expect-error A list success never carries the count result.\n";
  const countNegative = "  // @ts-expect-error A count success never carries the list result.\n";
  assert.ok(fixture.includes(listNegative) && fixture.includes(countNegative));
  const workspace = mkdtempSync(path.join(os.tmpdir(), "cli-canon-type-certification-"));
  try {
    symlinkSync(path.join(root, "node_modules"), path.join(workspace, "node_modules"), "dir");
    writeFileSync(
      path.join(workspace, "tsconfig.json"),
      JSON.stringify({
        extends: path.join(root, "tsconfig.json"),
        compilerOptions: { noEmit: true },
        include: ["./*.ts"],
      }),
    );
    const check = (source) => {
      writeFileSync(path.join(workspace, "fixture.ts"), source);
      return runTsc(["-p", path.join(workspace, "tsconfig.json"), "--pretty", "false"], workspace);
    };

    const intact = check(fixture);
    assert.equal(intact.status, 0, intact.stdout + intact.stderr);

    const withoutNegatives = check(fixture.replace(listNegative, "").replace(countNegative, ""));
    assert.notEqual(withoutNegatives.status, 0);
    const diagnostics = withoutNegatives.stdout.split(/\r?\n/u).filter((line) => line.includes("error TS"));
    assert.equal(diagnostics.length, 2, withoutNegatives.stdout);
    assert.match(diagnostics[0], /^fixture\.ts\(\d+,\d+\): error TS2339: Property 'total' does not exist/u);
    assert.match(diagnostics[1], /^fixture\.ts\(\d+,\d+\): error TS2339: Property 'entries' does not exist/u);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
