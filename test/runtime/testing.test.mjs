import assert from "node:assert/strict";
import test from "node:test";
import { certifyScenarios } from "../../dist/testing/index.js";

test("certification scenarios carry command, input, setup, and required lanes", async () => {
  const events = [];
  const scenario = {
    id: "read contract",
    commandId: "document.read",
    input: { value: 2 },
    expected: 4,
    requiredLanes: ["source"],
    setup: (context, input) => {
      events.push(["setup", context.name, input.value]);
    },
    run: (context, input) => {
      events.push(["run", context.name, input.value]);
      return input.value * context.multiplier;
    },
  };
  const results = await certifyScenarios(
    [scenario],
    [{ id: "source", context: { name: "source", multiplier: 2 } }],
    (actual, expected, location) => {
      assert.equal(actual, expected);
      assert.deepEqual(location, {
        scenarioId: "read contract",
        commandId: "document.read",
        laneId: "source",
      });
    },
  );
  assert.deepEqual(events, [
    ["setup", "source", 2],
    ["run", "source", 2],
  ]);
  assert.deepEqual(results, [{
    scenarioId: "read contract",
    commandId: "document.read",
    laneId: "source",
    actual: 4,
  }]);
});

test("certification rejects a missing required lane", async () => {
  await assert.rejects(
    () => certifyScenarios(
      [{
        id: "packed contract",
        commandId: "document.read",
        input: null,
        expected: true,
        requiredLanes: ["packed"],
        run: () => true,
      }],
      [{ id: "source", context: {} }],
      () => {},
    ),
    /requires missing lane packed/,
  );
});
