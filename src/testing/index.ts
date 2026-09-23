export * from "./node-test-tap.js";

export type CertificationLaneId = "source" | "built" | "packed";

export interface CertificationScenario<Context, Expected, Input = undefined, CommandId extends string = string> {
  readonly id: string;
  readonly commandId: CommandId;
  readonly input: Input;
  readonly expected: Expected;
  readonly requiredLanes: readonly CertificationLaneId[];
  readonly setup?: (context: Context, input: Input) => void | Promise<void>;
  readonly run: (context: Context, input: Input) => Expected | Promise<Expected>;
}

export interface CertificationLane<Context> {
  readonly id: CertificationLaneId;
  readonly context: Context;
}

export interface CertificationLocation {
  readonly scenarioId: string;
  readonly commandId: string;
  readonly laneId: CertificationLaneId;
}

export type CertificationAssertion<Expected> = (
  actual: Expected,
  expected: Expected,
  location: CertificationLocation,
) => void | Promise<void>;

export interface CertificationResult<Expected> extends CertificationLocation {
  readonly actual: Expected;
}

/** Run each independent scenario expectation against every lane the scenario declares as required. */
export async function certifyScenarios<Context, Expected, Input = undefined, CommandId extends string = string>(
  scenarios: readonly CertificationScenario<Context, Expected, Input, CommandId>[],
  lanes: readonly CertificationLane<Context>[],
  assertExpected: CertificationAssertion<Expected>,
): Promise<readonly CertificationResult<Expected>[]> {
  const laneById = new Map<CertificationLaneId, CertificationLane<Context>>();
  for (const lane of lanes) {
    if (laneById.has(lane.id)) throw new Error(`duplicate certification lane: ${lane.id}`);
    laneById.set(lane.id, lane);
  }

  const results: CertificationResult<Expected>[] = [];
  for (const scenario of scenarios) {
    if (scenario.requiredLanes.length === 0) {
      throw new Error(`certification scenario ${scenario.id} must require at least one lane`);
    }
    for (const laneId of scenario.requiredLanes) {
      const lane = laneById.get(laneId);
      if (lane === undefined) {
        throw new Error(`certification scenario ${scenario.id} requires missing lane ${laneId}`);
      }
      await scenario.setup?.(lane.context, scenario.input);
      const location = Object.freeze({
        scenarioId: scenario.id,
        commandId: scenario.commandId,
        laneId,
      });
      const actual = await scenario.run(lane.context, scenario.input);
      await assertExpected(actual, scenario.expected, location);
      results.push(Object.freeze({ ...location, actual }));
    }
  }

  return Object.freeze(results);
}
