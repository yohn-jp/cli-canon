import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fixturePackageMetadata from "../runtime/fixture-package.json" with { type: "json" };
import { assertRootImportPure } from "./root-import-purity.mjs";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

const root = process.cwd();
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const packDir = mkdtempSync(path.join(os.tmpdir(), "cli-canon-pack-"));
const consumer = mkdtempSync(path.join(os.tmpdir(), "cli-canon-consumer-"));

try {
  run("pnpm", ["pack", "--pack-destination", packDir], { cwd: root });
  const archives = readdirSync(packDir).filter((file) => file.endsWith(".tgz"));
  assert.equal(archives.length, 1, "pnpm pack must produce one tarball");
  const tarball = path.resolve(packDir, archives[0]);
  const packedFiles = run("tar", ["-tzf", tarball]).stdout.split(/\r?\n/u);
  for (const file of [
    "package/package.json",
    "package/dist/index.js",
    "package/dist/index.d.ts",
    "package/dist/node/index.js",
    "package/dist/node/index.d.ts",
    "package/dist/testing/index.js",
    "package/dist/testing/index.d.ts",
  ]) {
    assert.ok(packedFiles.includes(file), `packed tarball must contain ${file}`);
  }

  const packedManifest = JSON.parse(run("tar", ["-xOf", tarball, "package/package.json"]).stdout);
  assert.equal(packedManifest.name, "@yohn-jp/cli-canon");
  assert.deepEqual(packedManifest.exports["."], {
    types: "./dist/index.d.ts",
    import: "./dist/index.js",
  });
  assert.deepEqual(packedManifest.exports["./node"], {
    types: "./dist/node/index.d.ts",
    import: "./dist/node/index.js",
  });
  assert.deepEqual(packedManifest.exports["./testing"], {
    types: "./dist/testing/index.d.ts",
    import: "./dist/testing/index.js",
  });

  writeFileSync(
    path.join(consumer, "package.json"),
    JSON.stringify(
      {
        ...fixturePackageMetadata,
        type: "module",
        private: true,
        dependencies: {
          "@yohn-jp/cli-canon": `file:${tarball}`,
          zod: "4.6.5",
        },
        devDependencies: { typescript: "6.0.3" },
      },
      null,
      2,
    ),
  );

  for (const filename of ["fixture-scenario.mjs", "fixture-oracle.mjs"]) {
    copyFileSync(path.join(testDirectory, "..", "runtime", filename), path.join(consumer, filename));
  }
  for (const filename of ["failure.test.mjs", "passing.test.mjs"]) {
    copyFileSync(path.join(testDirectory, "..", "fixtures", "node-test", filename), path.join(consumer, filename));
  }
  copyFileSync(path.join(testDirectory, "root-import-purity.mjs"), path.join(consumer, "root-import-purity.mjs"));

  writeFileSync(
    path.join(consumer, "consumer.ts"),
    `import * as z from "zod";
import {
  bindHandlers,
  compilePaths,
  compileProduct,
  defineCommands,
  definePaths,
  jsonOutput,
  option,
  positional,
  resolvePaths,
  type CliIO,
  type CliOutcome,
  type CommandId,
  type DomainErrorAdapter,
  type PathId,
  type PathParameterName,
  projectProductSchemas,
  projectInvocation,
  type ProductPackageIdentity,
  defineSkills,
  projectSkill,
  renderSkillJson,
} from "@yohn-jp/cli-canon";
import { runNodeCli } from "@yohn-jp/cli-canon/node";
import {
  certifyScenarios,
  projectNodeTestTap,
  type CertificationScenario,
  type NodeTestTapCounts,
  type NodeTestTapProjection,
} from "@yohn-jp/cli-canon/testing";

const commands = defineCommands({
  "example.echo": {
    route: ["echo"],
    summary: "Echo a message.",
    description: "Write the supplied message and optional annotations.",
    examples: ["fixture-cli echo hello --format=full"],
    input: {
      message: positional(z.string().min(1), { metavar: "message" }),
      suffix: positional(z.string(), { required: false }),
      format: option("--format", z.enum(["full", "json"]), { valueArity: "optional" }),
    },
    result: z.object({ message: z.string(), suffix: z.string().optional(), format: z.string().optional() }),
  },
});
const handlers = bindHandlers(commands)({ "example.echo": ({ message, suffix, format }) => {
  suffix satisfies string | undefined;
  // @ts-expect-error optional positional input can be absent.
  suffix.toUpperCase();
  format satisfies "full" | "json" | undefined;
  return { message, suffix, format };
} });
const packageMetadata: ProductPackageIdentity = {
  name: "fixture-cli",
  version: "2.4.1",
  bin: { "fixture-cli": "./bin/fixture-cli.js" },
};
const product = compileProduct({ name: "fixture-cli", packageMetadata, commands, handlers, schemaProjectionCompleteness: "complete" });
void projectProductSchemas(product, "complete");
void runNodeCli(product, ["echo", "typed package", "--format=full"]);
const invocation = projectInvocation(product, "example.echo", { message: "typed package", format: "full" });
if (invocation.state !== "ready") throw new Error("packed invocation must be ready");
invocation.value.argv satisfies readonly string[];
const skills = defineSkills({
  setup: {
    summary: "Prepare the product.",
    intent: "Use the existing product readiness result.",
    invariants: ["Do not recompute product decisions."],
    references: [{ kind: "domain-result", id: "product.readiness" }],
    steps: [{ kind: "delegate", skillId: "details" }],
  },
  details: { summary: "Review details.", steps: [{ kind: "prose", text: "Inspect the existing result." }] },
});
const skillProduct = compileProduct({ name: "fixture-cli", commands, handlers, skills });
const skill = projectSkill(skillProduct, "setup");
void renderSkillJson(skill);
const invalidDelegation = defineSkills({
  setup: { summary: "Invalid delegation.", steps: [{ kind: "delegate", skillId: "unknown" }] },
});
// @ts-expect-error Packed types reject Skill references outside the declared catalog.
compileProduct({ name: "fixture-cli", commands, handlers, skills: invalidDelegation });
type Id = CommandId<typeof commands>;
const validId: Id = "example.echo";
void validId;
// @ts-expect-error IDs are inferred from the declarations in the packed types.
const invalidId: Id = "example.unknown";
void invalidId;
const paths = definePaths({
  app: {
    root: {
      candidates: [
        { env: "APP_DATA", absoluteOnly: true },
        { platform: "win32", root: { env: "LOCALAPPDATA" }, segments: ["fixture"] },
        { default: "home", segments: [".local", "share", "fixture"] },
      ],
    },
  },
  project: { parent: "app", segments: ["projects", { param: "projectId" }], kind: "directory" },
  manifest: { parent: "project", segments: ["manifest.json"], kind: "file" },
});
const compiledPaths = compilePaths(paths);
void resolvePaths(compiledPaths, {
  platform: "posix",
  home: "/home/user",
  parameters: { projectId: "fixture-1" },
});
type Path = PathId<typeof paths>;
const validPath: Path = "manifest";
void validPath;
// @ts-expect-error Path IDs are inferred from the packed declarations.
const invalidPath: Path = "missing";
void invalidPath;
type Parameter = PathParameterName<typeof paths>;
const validParameter: Parameter = "projectId";
void validParameter;
// @ts-expect-error Required path parameters are inferred from the packed declarations.
const invalidParameter: Parameter = "workspaceId";
void invalidParameter;
// @ts-expect-error Packed resolution types require every declared path parameter.
resolvePaths(compiledPaths, { platform: "posix", home: "/home/user" });
// @ts-expect-error Packed resolution types reject undeclared path parameters.
resolvePaths(compiledPaths, {
  platform: "posix",
  home: "/home/user",
  parameters: { projectId: "fixture-1", extra: "unexpected" },
});

interface ExampleDomainError { readonly code: "EXAMPLE_DENIED"; readonly message: string }
const domainErrorAdapter: DomainErrorAdapter<ExampleDomainError> = {
  is: (error): error is ExampleDomainError => typeof error === "object"
    && error !== null && "code" in error && error.code === "EXAMPLE_DENIED"
    && "message" in error && typeof error.message === "string",
  map: (error) => ({ exitCode: 9, stream: "stderr", output: error.message + "\\n" }),
};
void runNodeCli(product, ["echo", "typed package"], { domainErrorAdapter });
const io: CliIO = { writeStdout: (_output) => {}, writeStderr: (_output) => {} };
const outcome: CliOutcome = jsonOutput({ ok: true }, { maxBytes: 64 });
void io;
void outcome;
const typedScenario: CertificationScenario<{ multiplier: number }, number, { value: string }, "example.echo"> = {
  id: "typed certification",
  commandId: "example.echo",
  input: { value: "x" },
  expected: 1,
  requiredLanes: ["packed"],
  run: ({ multiplier }, input) => input.value.length * multiplier,
};
void certifyScenarios([typedScenario], [{ id: "packed", context: { multiplier: 1 } }], (actual, expected) => {
  if (actual !== expected) throw new Error("scenario did not match its independent expectation");
});
const packedTapProjection: NodeTestTapProjection = projectNodeTestTap(
  "TAP version 13\\n# tests 0\\n# suites 0\\n# pass 0\\n# fail 0\\n# cancelled 0\\n# skipped 0\\n# todo 0\\n",
  0,
);
const tapCounts: NodeTestTapCounts = packedTapProjection.counts;
const tapFailure = packedTapProjection.failures[0];
packedTapProjection.status satisfies "passed" | "failed";
packedTapProjection.exitCode satisfies number;
tapCounts.tests satisfies number;
tapFailure?.name satisfies string | undefined;
tapFailure?.status satisfies "passed" | "failed" | "skipped" | "todo" | "cancelled" | undefined;
tapFailure?.file satisfies string | undefined;
tapFailure?.line satisfies number | undefined;
tapFailure?.column satisfies number | undefined;
tapFailure?.message satisfies string | undefined;
tapFailure?.expected satisfies unknown;
tapFailure?.actual satisfies unknown;
tapFailure?.stack satisfies string | undefined;
tapFailure?.diagnostics satisfies string | undefined;
void packedTapProjection.failures;

`,
  );

  writeFileSync(
    path.join(consumer, "consumer.mjs"),
    `import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import * as api from "@yohn-jp/cli-canon";
import * as node from "@yohn-jp/cli-canon/node";
import packageMetadata from "./package.json" with { type: "json" };
import { certifyScenarios, projectNodeTestTap } from "@yohn-jp/cli-canon/testing";
import { createCertificationScenario } from "./fixture-scenario.mjs";

assert.equal("certifyScenarios" in api, false, "testing helpers must stay outside the runtime root entrypoint");
assert.equal("projectNodeTestTap" in api, false, "testing helpers must stay outside the runtime root entrypoint");
await certifyScenarios(
  [createCertificationScenario(packageMetadata, ["packed"])],
  [{ id: "packed", context: { api, node } }],
  (actual, expected) => assert.deepEqual(actual, expected),
);
function runNodeTestFile(filename) {
  const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", path.join(process.cwd(), filename)], {
    encoding: "utf8",
  });
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, null);
  return projectNodeTestTap(result.stdout, result.status ?? -1);
}
const packedFailure = runNodeTestFile("failure.test.mjs");
assert.equal(packedFailure.status, "failed");
assert.equal(packedFailure.exitCode, 1);
assert.deepEqual(packedFailure.counts, {
  tests: 1,
  suites: 0,
  pass: 0,
  fail: 1,
  cancelled: 0,
  skipped: 0,
  todo: 0,
});
assert.deepEqual(packedFailure.tests.map(({ name, status }) => ({ name, status })), [
  { name: "projection preserves assertion diagnostics", status: "failed" },
]);
assert.equal(packedFailure.failures[0]?.name, "projection preserves assertion diagnostics");
assert.equal(packedFailure.failures[0]?.status, "failed");
assert.equal(packedFailure.failures[0]?.file, path.join(process.cwd(), "failure.test.mjs"));
assert.equal(packedFailure.failures[0]?.line, 3);
assert.equal(packedFailure.failures[0]?.column, 1);
assert.match(packedFailure.failures[0]?.message, /Expected values to be strictly equal/u);
assert.equal(packedFailure.failures[0]?.expected, "expected");
assert.equal(packedFailure.failures[0]?.actual, "actual");
assert.ok(packedFailure.failures[0]?.diagnostics?.includes("ERR_ASSERTION"));
assert.match(packedFailure.failures[0]?.stack, /failure\.test\.mjs:3:/u);
assert.ok(packedFailure.failures[0]?.diagnostics?.includes("expected: 'expected'"));
assert.ok(packedFailure.failures[0]?.diagnostics?.includes("actual: 'actual'"));
const packedPass = runNodeTestFile("passing.test.mjs");
assert.equal(packedPass.status, "passed");
assert.equal(packedPass.exitCode, 0);
assert.deepEqual(packedPass.counts, {
  tests: 2,
  suites: 0,
  pass: 2,
  fail: 0,
  cancelled: 0,
  skipped: 0,
  todo: 0,
});
assert.deepEqual(packedPass.tests.map(({ name, status }) => ({ name, status })), [
  { name: "passes", status: "passed" },
  { name: "also passes", status: "passed" },
]);
assert.deepEqual(packedPass.failures, []);
const expectedJson = '{"message":"雪"}\\n';
const jsonBytes = Buffer.byteLength(expectedJson, "utf8");
const output = api.jsonOutput({ message: "雪" }, { maxBytes: jsonBytes });
assert.deepEqual(output, {
  status: "success",
  stream: "stdout",
  output: expectedJson,
  exitCode: 0,
});
assert.deepEqual(api.jsonOutput({ message: "雪" }, { maxBytes: jsonBytes - 1 }), {
  status: "failure",
  stream: "stderr",
  output: "",
  exitCode: 1,
  failureKind: "budget",
});
const writes = [];
api.writeCliOutcome(output, {
  writeStdout: (text) => writes.push(["stdout", text]),
  writeStderr: (text) => writes.push(["stderr", text]),
});
assert.deepEqual(writes, [["stdout", expectedJson]]);
const nonFinite = api.jsonOutput({ value: Number.NaN });
assert.equal(nonFinite.status, "failure");
assert.equal(nonFinite.failureKind, "serialization");
const packedSkills = api.defineSkills({
  setup: {
    summary: "Prepare the product.",
    intent: "Use the existing readiness result.",
    invariants: ["Do not recompute decisions."],
    references: [{ kind: "domain-result", id: "product.readiness" }],
    steps: [{ kind: "delegate", skillId: "details" }],
  },
  details: { summary: "Review details.", steps: [{ kind: "prose", text: "Inspect the result." }] },
});
const packedSkillProduct = api.compileProduct({ name: "fixture-cli", commands: {}, handlers: {}, skills: packedSkills });
const packedSkill = api.projectSkill(packedSkillProduct, "setup");
assert.equal(packedSkill.intent, "Use the existing readiness result.");
assert.equal(packedSkill.steps[0].skillId, "details");
assert.deepEqual(JSON.parse(api.renderSkillJson(packedSkill)), packedSkill);
const paths = api.compilePaths(api.definePaths({
  app: {
    root: {
      candidates: [
        { env: "APP_DATA", absoluteOnly: true },
        { platform: "win32", root: { env: "LOCALAPPDATA" }, segments: ["fixture"] },
        { default: "home", segments: [".local", "share", "fixture"] },
      ],
    },
  },
  project: { parent: "app", segments: ["projects", { param: "projectId" }] },
  manifest: { parent: "project", segments: ["manifest.json"], kind: "file" },
}));
assert.equal(paths.paths.find((entry) => entry.id === "manifest")?.kind, "file");
assert.equal(api.resolvePaths(paths, {
  platform: "posix",
  home: "/home/user",
  env: { APP_DATA: "relative/value" },
  parameters: { projectId: "fixture-1" },
}).manifest, "/home/user/.local/share/fixture/projects/fixture-1/manifest.json");

console.log("packed consumer verified");
`,
  );

  writeFileSync(
    path.join(consumer, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          noEmit: true,
        },
        include: ["consumer.ts"],
      },
      null,
      2,
    ),
  );

  run("pnpm", ["install", "--frozen-lockfile=false"], { cwd: consumer });
  await assertRootImportPure({ cwd: consumer, specifier: "@yohn-jp/cli-canon" });
  run(process.execPath, ["consumer.mjs"], { cwd: consumer });
  run("pnpm", ["exec", "tsc", "-p", "tsconfig.json"], { cwd: consumer });
  await assertRootImportPure({
    cwd: root,
    specifier: new URL("../../dist/index.js", import.meta.url).href,
  });
} finally {
  rmSync(packDir, { recursive: true, force: true });
  rmSync(consumer, { recursive: true, force: true });
}
