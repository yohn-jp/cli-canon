import assert from "node:assert/strict";
import test from "node:test";
test("projection preserves assertion diagnostics", () => assert.equal("actual", "expected"));
