import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";

test("root import has no CLI output or process exit side effect", () => {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", "await import('./dist/index.js')"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});
