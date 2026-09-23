import { spawnSync } from "node:child_process";
import { projectNodeTestTap } from "@yohn-jp/cli-canon/testing";

const testFile = process.argv[2];
if (testFile === undefined) throw new Error("A node:test fixture path is required");

const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", testFile], { encoding: "utf8" });
if (result.error !== undefined) throw result.error;
if (result.status === null) throw new Error("node:test did not return an exit code");

const projection = projectNodeTestTap(result.stdout, result.status);
const skipped = projection.counts.cancelled + projection.counts.skipped + projection.counts.todo;
const vitestResult = {
  numTotalTests: projection.counts.tests,
  numPassedTests: projection.counts.pass,
  numFailedTests: projection.counts.fail,
  numPendingTests: skipped,
  testResults: [
    {
      name: testFile,
      assertionResults: projection.tests.map((testCase) => ({
        status: testCase.status === "todo" || testCase.status === "cancelled" ? "skipped" : testCase.status,
        title: testCase.name,
        ...(testCase.file === undefined ? {} : { file: testCase.file }),
        ...(testCase.line === undefined || testCase.column === undefined
          ? {}
          : { location: { start: { line: testCase.line, column: testCase.column } } }),
        ...(testCase.message === undefined ? {} : { message: testCase.message, assertion: testCase.message }),
        ...(testCase.diagnostics === undefined ? {} : { diagnostic: testCase.diagnostics }),
        ...(testCase.stack === undefined ? {} : { stack: testCase.stack }),
      })),
    },
  ],
};

process.stdout.write(JSON.stringify(vitestResult));
process.exitCode = result.status;
