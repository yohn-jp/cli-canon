import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

function requiredEnvironment(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`missing required release context: ${name}`);
  }
  return value;
}

function tar(args) {
  const result = spawnSync("tar", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`tar ${args.join(" ")} failed\n${result.stderr}`);
  }
  return result.stdout;
}

const sourceSha = requiredEnvironment("RELEASE_SOURCE_SHA");
const releaseTag = requiredEnvironment("RELEASE_TAG");
const artifactPath = requiredEnvironment("RELEASE_ARTIFACT_PATH");
const expectedSha256 = requiredEnvironment("RELEASE_ARTIFACT_SHA256");

assert.match(sourceSha, /^[0-9a-f]{40}$/u, "release source SHA must be a full commit SHA");
assert.match(expectedSha256, /^[0-9a-f]{64}$/u, "release artifact SHA-256 must be canonical");

const artifactBytes = readFileSync(artifactPath);
const actualSha256 = createHash("sha256").update(artifactBytes).digest("hex");
assert.equal(actualSha256, expectedSha256, "release tarball bytes changed after packing");

const manifest = JSON.parse(tar(["-xOf", artifactPath, "package/package.json"]));
assert.equal(manifest.name, "@yohn-jp/cli-canon");
assert.equal(releaseTag, `v${manifest.version}`, "release tag must match package version");
assert.equal(manifest.engines?.node, ">=24");

assert.deepEqual(manifest.exports?.["."], {
  types: "./dist/index.d.ts",
  import: "./dist/index.js",
});
assert.deepEqual(manifest.exports?.["./node"], {
  types: "./dist/node/index.d.ts",
  import: "./dist/node/index.js",
});
assert.deepEqual(manifest.exports?.["./testing"], {
  types: "./dist/testing/index.d.ts",
  import: "./dist/testing/index.js",
});

const files = new Set(tar(["-tzf", artifactPath]).split(/\r?\n/u).filter(Boolean));
for (const file of [
  "package/package.json",
  "package/README.md",
  "package/dist/index.js",
  "package/dist/index.d.ts",
  "package/dist/node/index.js",
  "package/dist/node/index.d.ts",
  "package/dist/testing/index.js",
  "package/dist/testing/index.d.ts",
]) {
  assert.ok(files.has(file), `release tarball is missing ${file}`);
}

console.log(
  JSON.stringify({
    ok: true,
    package: manifest.name,
    version: manifest.version,
    tag: releaseTag,
    sourceSha,
    artifactSha256: actualSha256,
  }),
);
