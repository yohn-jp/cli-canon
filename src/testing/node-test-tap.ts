export type NodeTestTapCaseStatus = "passed" | "failed" | "skipped" | "todo" | "cancelled";

export interface NodeTestTapCounts {
  readonly tests: number;
  readonly suites: number;
  readonly pass: number;
  readonly fail: number;
  readonly cancelled: number;
  readonly skipped: number;
  readonly todo: number;
}

export interface NodeTestTapCase {
  readonly name: string;
  readonly status: NodeTestTapCaseStatus;
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
  readonly message?: string;
  readonly expected?: unknown;
  readonly actual?: unknown;
  readonly stack?: string;
  readonly diagnostics?: string;
}

export interface NodeTestTapProjection {
  readonly status: "passed" | "failed";
  readonly exitCode: number;
  readonly counts: NodeTestTapCounts;
  readonly tests: readonly NodeTestTapCase[];
  readonly failures: readonly NodeTestTapCase[];
}

const SUMMARY_KEYS = ["tests", "suites", "pass", "fail", "cancelled", "skipped", "todo"] as const;
type SummaryKey = (typeof SUMMARY_KEYS)[number];

const TAP_POINT = /^( *)(not ok|ok)\s+(\d+)(?:\s+-\s+(.*?))?(?:\s+#\s*(SKIP|TODO|CANCELLED)(?:\s+.*)?)?\s*$/u;
const TAP_SUMMARY = /^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)$/u;

function parseYamlScalar(source: string): unknown {
  const value = source.trim();
  if (value === "") return "";

  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/gu, "'");
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value === "null" || value === "~") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/iu.test(value)) return Number(value);

  if (value.startsWith("[") || value.startsWith("{")) {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }
  return value;
}

function parseYamlFields(lines: readonly string[]): ReadonlyMap<string, unknown> {
  const fields = new Map<string, unknown>();
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^([A-Za-z][\w-]*):(?:\s+(.*))?$/u.exec(lines[index] ?? "");
    if (match === null) continue;

    const key = match[1];
    if (key === undefined) continue;
    const source = match[2] ?? "";
    if (/^[|>][+-]?$/u.test(source)) {
      const block: string[] = [];
      let next = index + 1;
      while (next < lines.length) {
        const line = lines[next] ?? "";
        if (line === "") {
          block.push("");
          next += 1;
        } else if (/^\s{2,}/u.test(line)) {
          block.push(line.slice(2));
          next += 1;
        } else {
          break;
        }
      }
      while (block.at(-1) === "") block.pop();
      fields.set(key, block.join("\n"));
      index = next - 1;
    } else if (source === "" && index + 1 < lines.length && /^\s{2,}/u.test(lines[index + 1] ?? "")) {
      const structured: string[] = [];
      let next = index + 1;
      while (next < lines.length && /^\s{2,}/u.test(lines[next] ?? "")) {
        structured.push((lines[next] ?? "").slice(2));
        next += 1;
      }
      fields.set(key, structured.join("\n"));
      index = next - 1;
    } else {
      fields.set(key, parseYamlScalar(source));
    }
  }
  return fields;
}

function parseSourceLocation(
  value: unknown,
): { readonly file: string; readonly line: number; readonly column: number } | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(.*):(\d+):(\d+)$/u.exec(value);
  if (match === null || match[1] === undefined || match[2] === undefined || match[3] === undefined) return undefined;
  return { file: match[1], line: Number(match[2]), column: Number(match[3]) };
}

function makeCase(
  result: "ok" | "not ok",
  name: string,
  directive: string | undefined,
  fields: ReadonlyMap<string, unknown>,
  diagnostics: string | undefined,
): NodeTestTapCase {
  const status: NodeTestTapCaseStatus =
    directive === "SKIP"
      ? "skipped"
      : directive === "TODO"
        ? "todo"
        : directive === "CANCELLED"
          ? "cancelled"
          : result === "ok"
            ? "passed"
            : "failed";
  const location = parseSourceLocation(fields.get("location"));
  const message = fields.get("error");
  const stack = fields.get("stack");
  const testCase: NodeTestTapCase = {
    name,
    status,
    ...(location === undefined ? {} : location),
    ...(typeof message === "string" ? { message } : {}),
    ...(fields.has("expected") ? { expected: fields.get("expected") } : {}),
    ...(fields.has("actual") ? { actual: fields.get("actual") } : {}),
    ...(typeof stack === "string" ? { stack } : {}),
    ...(diagnostics === undefined ? {} : { diagnostics }),
  };
  return Object.freeze(testCase);
}

function readSummary(lines: readonly string[]): NodeTestTapCounts {
  let planIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (/^1\.\.\d+$/u.test(lines[index] ?? "")) planIndex = index;
  }
  if (planIndex < 0) throw new Error("Node test TAP output is missing the final test plan");

  const values = new Map<SummaryKey, number>();
  for (const line of lines.slice(planIndex + 1)) {
    const match = TAP_SUMMARY.exec(line);
    if (match === null) continue;
    const key = match[1] as SummaryKey;
    const value = Number(match[2]);
    if (!Number.isSafeInteger(value)) throw new Error(`Node test TAP output has an invalid # ${key} summary`);
    values.set(key, value);
  }

  for (const key of SUMMARY_KEYS) {
    if (!values.has(key)) throw new Error(`Node test TAP output is missing the # ${key} summary`);
  }

  return Object.freeze({
    tests: values.get("tests")!,
    suites: values.get("suites")!,
    pass: values.get("pass")!,
    fail: values.get("fail")!,
    cancelled: values.get("cancelled")!,
    skipped: values.get("skipped")!,
    todo: values.get("todo")!,
  });
}

/** Project Node's built-in TAP reporter output while retaining the runner's exit code and failure diagnostics. */
export function projectNodeTestTap(tap: string, exitCode: number): NodeTestTapProjection {
  if (!Number.isInteger(exitCode)) throw new TypeError("Node test exit code must be an integer");

  const lines = tap.split(/\r?\n/u);
  if (lines.find((line) => line.trim() !== "") !== "TAP version 13") {
    throw new Error("Node test TAP output is missing the TAP version 13 header");
  }

  const tests: NodeTestTapCase[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = TAP_POINT.exec(line);
    if (match === null) continue;

    const result = match[2] as "ok" | "not ok";
    const name = match[4] ?? match[3] ?? "";
    const directive = match[5];
    let diagnostics: string | undefined;
    let fields: ReadonlyMap<string, unknown> = new Map();
    const indentation = (match[1] ?? "").length;
    if (lines[index + 1] === `${" ".repeat(indentation + 2)}---`) {
      const start = index + 1;
      let end = start + 1;
      while (end < lines.length && lines[end] !== `${" ".repeat(indentation + 2)}...`) end += 1;
      if (end < lines.length) {
        const diagnosticLines = lines.slice(start, end + 1);
        diagnostics = diagnosticLines.join("\n");
        fields = parseYamlFields(
          lines.slice(start + 1, end).map((diagnosticLine) => diagnosticLine.slice(indentation + 2)),
        );
        index = end;
      }
    }
    tests.push(makeCase(result, name, directive, fields, diagnostics));
  }

  const counts = readSummary(lines);
  const frozenTests = Object.freeze(tests);
  const failures = Object.freeze(frozenTests.filter((testCase) => testCase.status === "failed"));
  return Object.freeze({
    status: exitCode === 0 && counts.fail === 0 ? "passed" : "failed",
    exitCode,
    counts,
    tests: frozenTests,
    failures,
  });
}
