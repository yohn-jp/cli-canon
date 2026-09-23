import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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

  writeFileSync(
    path.join(consumer, "package.json"),
    JSON.stringify(
      {
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
} from "@yohn-jp/cli-canon";
import { runNodeCli } from "@yohn-jp/cli-canon/node";

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
const product = compileProduct({ name: "fixture-cli", commands, handlers });
void runNodeCli(product, ["echo", "typed package", "--format=full"]);
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

`,
  );

  writeFileSync(
    path.join(consumer, "consumer.mjs"),
    `import assert from "node:assert/strict";
import * as api from "@yohn-jp/cli-canon";
import * as node from "@yohn-jp/cli-canon/node";
import { certificationOracle } from "./fixture-oracle.mjs";
import { runCertificationScenario } from "./fixture-scenario.mjs";

assert.deepEqual(await runCertificationScenario(api, node), certificationOracle);
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
