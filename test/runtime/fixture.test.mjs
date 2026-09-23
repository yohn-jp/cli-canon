import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import * as api from "../../dist/index.js";
import * as node from "../../dist/node/index.js";
import { certificationOracle } from "./fixture-oracle.mjs";
import { runCertificationScenario } from "./fixture-scenario.mjs";

test("shared certification scenario matches its independent oracle against built JS", async () => {
  assert.deepEqual(await runCertificationScenario(api, node), certificationOracle);
});

test("shared certification scenario matches its independent oracle against TypeScript source", async () => {
  const sourceUrl = new URL("../../src/", import.meta.url).href;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL?.startsWith(sourceUrl) && specifier.endsWith(".js")) {
        return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
      }
      return nextResolve(specifier, context);
    },
  });

  const [sourceApi, sourceNode] = await Promise.all([
    import("../../src/index.ts"),
    import("../../src/node/index.ts"),
  ]);
  assert.deepEqual(await runCertificationScenario(sourceApi, sourceNode), certificationOracle);
});
