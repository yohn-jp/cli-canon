export type CertificationLaneId = "source" | "built" | "packed";

export interface CertificationScenario<Context, Expected> {
  readonly id: string;
  readonly expected: Expected;
  readonly run: (context: Context) => Expected | Promise<Expected>;
}

export interface CertificationLane<Context> {
  readonly id: CertificationLaneId;
  readonly context: Context;
}

export interface CertificationLocation {
  readonly scenarioId: string;
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

/** Run each independent scenario expectation against every supplied package lane. */
export async function certifyScenarios<Context, Expected>(
  scenarios: readonly CertificationScenario<Context, Expected>[],
  lanes: readonly CertificationLane<Context>[],
  assertExpected: CertificationAssertion<Expected>,
): Promise<readonly CertificationResult<Expected>[]> {
  const results: CertificationResult<Expected>[] = [];

  for (const scenario of scenarios) {
    for (const lane of lanes) {
      const location = Object.freeze({ scenarioId: scenario.id, laneId: lane.id });
      const actual = await scenario.run(lane.context);
      await assertExpected(actual, scenario.expected, location);
      results.push(Object.freeze({ ...location, actual }));
    }
  }

  return Object.freeze(results);
}
