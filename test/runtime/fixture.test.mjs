import assert from "node:assert/strict";
import test from "node:test";
import * as api from "../../dist/index.js";
import * as node from "../../dist/node/index.js";
import { certificationOracle } from "./fixture-oracle.mjs";
import { runCertificationScenario } from "./fixture-scenario.mjs";

test("shared certification scenario matches its independent oracle against built JS", async () => {
  assert.deepEqual(await runCertificationScenario(api, node), certificationOracle);
});
