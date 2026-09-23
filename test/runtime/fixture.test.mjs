import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import packageMetadata from "./fixture-package.json" with { type: "json" };
import * as api from "../../dist/index.js";
import * as node from "../../dist/node/index.js";
import { certifyScenarios } from "../../dist/testing/index.js";
import { createCertificationScenario } from "./fixture-scenario.mjs";

test("independent scenario expectations certify source and built JS", async () => {
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
  await certifyScenarios(
    [createCertificationScenario(packageMetadata, ["built", "source"])],
    [
      { id: "built", context: { api, node } },
      { id: "source", context: { api: sourceApi, node: sourceNode } },
    ],
    (actual, expected, location) =>
      assert.deepEqual(actual, expected, `${location.scenarioId} against ${location.laneId}`),
  );
});
