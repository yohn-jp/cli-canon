import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * Builds one release-candidate tarball from the committed candidate tree, or accepts one
 * already-built candidate tarball, records its identity, and certifies that exact artifact
 * with the packed consumer and the release smoke test.
 *
 * Usage:
 *   node test/package/release-candidate.mjs --out <empty directory>
 *   node test/package/release-candidate.mjs --out <empty directory> --tarball <candidate.tgz>
 */

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

const outIndex = process.argv.indexOf("--out");
assert.ok(outIndex !== -1 && process.argv[outIndex + 1] !== undefined, "usage: release-candidate.mjs --out <dir>");
const tarballIndex = process.argv.indexOf("--tarball");
const suppliedTarball = tarballIndex === -1 ? undefined : process.argv[tarballIndex + 1];
assert.ok(tarballIndex === -1 || suppliedTarball !== undefined, "--tarball requires a candidate tarball path");
const outDir = path.resolve(process.argv[outIndex + 1]);
mkdirSync(outDir, { recursive: true });
assert.deepEqual(readdirSync(outDir), [], "the artifact directory must start empty");

const root = process.cwd();
const head = run("git", ["rev-parse", "HEAD"], { cwd: root }).stdout.trim();
const dirty = run("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root })
  .stdout.split("\n")
  .filter((line) => line !== "" && !/^\?\? (dist|node_modules)\//u.test(line));
assert.deepEqual(dirty, [], "the candidate tree must be committed before the artifact is built");

const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const expectedFilename = `yohn-jp-cli-canon-${manifest.version}.tgz`;
let tarball;
if (suppliedTarball === undefined) {
  run("pnpm", ["pack", "--pack-destination", outDir], { cwd: root });
  const archives = readdirSync(outDir).filter((file) => file.endsWith(".tgz"));
  assert.deepEqual(archives, [expectedFilename], "pnpm pack must produce one tarball");
  tarball = path.join(outDir, archives[0]);
} else {
  tarball = path.resolve(suppliedTarball);
  assert.equal(path.basename(tarball), expectedFilename, "supplied tarball name must match the candidate version");
}

const digest = () => createHash("sha256").update(readFileSync(tarball)).digest("hex");
const identity = {
  sourceCommit: head,
  version: manifest.version,
  filename: path.basename(tarball),
  bytes: statSync(tarball).size,
  sha256: digest(),
  inventory: run("tar", ["-tvzf", tarball])
    .stdout.split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [, , size, , , ...name] = line.split(/\s+/u);
      return { path: name.join(" "), bytes: Number(size) };
    }),
};
writeFileSync(path.join(outDir, "release-candidate.json"), JSON.stringify(identity, null, 2) + "\n");

run(process.execPath, [path.join(root, "test", "package", "consumer.mjs")], {
  cwd: root,
  env: { ...process.env, CLI_CANON_TARBALL: tarball },
  stdio: "inherit",
});
run(process.execPath, [path.join(root, "scripts", "smoke-test.mjs"), "--tarball", tarball], {
  cwd: root,
  stdio: "inherit",
});

assert.equal(digest(), identity.sha256, "the certified artifact must be unchanged");
assert.equal(run("git", ["rev-parse", "HEAD"], { cwd: root }).stdout.trim(), head, "HEAD must not move");
console.log(JSON.stringify(identity, null, 2));
console.log("release candidate certified");
