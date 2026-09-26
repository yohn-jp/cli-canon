import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * Builds one release-candidate tarball from the committed candidate tree, records its identity,
 * and certifies that exact artifact with the packed consumer and the release smoke test.
 *
 * Usage: node test/package/release-candidate.mjs --out <empty directory>
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
run("pnpm", ["pack", "--pack-destination", outDir], { cwd: root });
const archives = readdirSync(outDir).filter((file) => file.endsWith(".tgz"));
assert.deepEqual(archives, [`yohn-jp-cli-canon-${manifest.version}.tgz`], "pnpm pack must produce one tarball");
const tarball = path.join(outDir, archives[0]);

const digest = () => createHash("sha256").update(readFileSync(tarball)).digest("hex");
const identity = {
  sourceCommit: head,
  version: manifest.version,
  filename: archives[0],
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
