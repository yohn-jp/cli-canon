import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { bindHandlers, compileProduct, defineCommands } from "../../dist/index.js";
import {
  PathConstructionError,
  PathResolutionError,
  compilePaths,
  definePaths,
  resolvePaths,
} from "../../dist/path/index.js";

test("compileProduct includes validated canonical paths", () => {
  const commands = defineCommands({});
  const paths = definePaths({ project: { root: "cwd", segments: ["project"] } });
  const product = compileProduct({ name: "fixture", commands, handlers: bindHandlers(commands)({}), paths });
  assert.equal(resolvePaths(product.paths, { platform: "posix", cwd: "/work" }).project, "/work/project");
});

test("path IDs and parent references resolve from explicit platform context", () => {
  const paths = definePaths({
    project: { root: "cwd" },
    projectAlias: { parent: "project" },
    cache: { parent: "project", segments: [".cache", "cli-canon"] },
    data: { root: { env: "APP_DATA" }, segments: ["cli-canon"] },
    config: { root: "home", segments: [".config", "cli-canon"] },
  });

  const compiled = compilePaths(paths);
  const resolved = resolvePaths(compiled, {
    platform: "posix",
    cwd: "/work/project/./",
    home: "/home/sophia",
    env: { APP_DATA: "/var/lib/../share/app" },
  });

  assert.equal(resolved.project, "/work/project");
  assert.equal(resolved.projectAlias, "/work/project");
  assert.equal(resolved.cache, "/work/project/.cache/cli-canon");
  assert.equal(resolved.data, "/var/share/app/cli-canon");
  assert.equal(resolved.config, "/home/sophia/.config/cli-canon");
  assert.equal(Object.isFrozen(compiled), true);
  assert.equal(Object.isFrozen(compiled.paths), true);
  assert.equal(Object.isFrozen(resolved), true);
});

test("path roots and parent segments use the explicit Windows lexical rules", () => {
  const paths = compilePaths(definePaths({
    workspace: { root: "cwd", segments: ["packages", "tool"] },
    cache: { parent: "workspace", segments: [".cache"] },
    shared: { root: { env: "SHARED_ROOT" }, segments: ["state"] },
  }));

  const resolved = resolvePaths(paths, {
    platform: "win32",
    cwd: "C:/work/./repo/../repo/",
    env: { SHARED_ROOT: "D:\\shared\\data\\" },
  });

  assert.equal(resolved.workspace, "C:\\work\\repo\\packages\\tool");
  assert.equal(resolved.cache, "C:\\work\\repo\\packages\\tool\\.cache");
  assert.equal(resolved.shared, "D:\\shared\\data\\state");
});

test("unknown references, cycles, and traversal segments fail during compilation", () => {
  assert.throws(
    () => compilePaths({ cache: { parent: "missing" } }),
    (error) => error instanceof PathConstructionError &&
      error.issues.some((entry) => entry.code === "UNKNOWN_PATH_REFERENCE"),
  );
  assert.throws(
    () => compilePaths({ first: { parent: "second" }, second: { parent: "first" } }),
    (error) => error instanceof PathConstructionError &&
      error.issues.some((entry) => entry.code === "PATH_CYCLE"),
  );
  for (const segment of ["..", ".", "../outside", "/absolute", "a\\b"]) {
    assert.throws(
      () => compilePaths({ invalid: { root: "cwd", segments: [segment] } }),
      (error) => error instanceof PathConstructionError &&
        error.issues.some((entry) => entry.code === "INVALID_PATH_SEGMENT"),
    );
  }
});

test("resolution requires explicit absolute context for each used root", () => {
  const cwdPath = compilePaths(definePaths({ cwdPath: { root: "cwd" } }));
  assert.throws(
    () => resolvePaths(cwdPath, { platform: "posix" }),
    (error) => error instanceof PathResolutionError &&
      error.issues[0]?.code === "MISSING_PATH_CONTEXT",
  );
  assert.throws(
    () => resolvePaths(cwdPath, { platform: "posix", cwd: "relative" }),
    (error) => error instanceof PathResolutionError &&
      error.issues[0]?.code === "INVALID_PATH_ROOT",
  );
  const envPath = compilePaths(definePaths({ envPath: { root: { env: "DATA_HOME" } } }));
  assert.throws(
    () => resolvePaths(envPath, { platform: "posix", env: {} }),
    (error) => error instanceof PathResolutionError &&
      error.issues[0]?.code === "MISSING_PATH_CONTEXT",
  );
});

test("path parameters are required single components and kind is projected", () => {
  const paths = compilePaths(definePaths({
    project: { root: "home", segments: ["projects", { param: "projectId" }] },
    report: { parent: "project", segments: ["report.json"], kind: "file" },
  }));

  assert.equal(paths.paths.find((entry) => entry.id === "project")?.kind, "directory");
  assert.equal(paths.paths.find((entry) => entry.id === "report")?.kind, "file");
  assert.equal(resolvePaths(paths, {
    platform: "posix",
    home: "/home/user",
    parameters: { projectId: "invoice-17" },
  }).report, "/home/user/projects/invoice-17/report.json");

  assert.throws(
    () => resolvePaths(paths, { platform: "posix", home: "/home/user" }),
    (error) => error instanceof PathResolutionError &&
      error.issues[0]?.code === "MISSING_PATH_PARAMETER" &&
      error.issues[0]?.pathId === "project",
  );
  for (const parameter of ["", ".", "..", "invoice/17", "invoice\\17"]) {
    assert.throws(
      () => resolvePaths(paths, {
        platform: "posix",
        home: "/home/user",
        parameters: { projectId: parameter },
      }),
      (error) => error instanceof PathResolutionError && error.issues[0]?.code === "INVALID_PATH_PARAMETER",
    );
  }
  assert.throws(
    () => resolvePaths(paths, {
      platform: "posix",
      home: "/home/user",
      parameters: { projectId: "invoice-17", extra: "unexpected" },
    }),
    (error) => error instanceof PathResolutionError && error.issues[0]?.code === "UNKNOWN_PATH_PARAMETER",
  );
});

test("ordered root strategies honor env, platform, and default precedence", () => {
  const paths = compilePaths(definePaths({
    data: {
      root: {
        candidates: [
          { env: "APP_DATA_HOME", absoluteOnly: true, segments: ["override"] },
          { platform: "win32", root: { env: "LOCALAPPDATA" }, segments: ["cli-canon"] },
          { default: "home", segments: [".local", "share", "cli-canon"] },
        ],
      },
      segments: ["state"],
    },
  }));

  assert.equal(resolvePaths(paths, {
    platform: "posix",
    home: "/home/user",
    env: { APP_DATA_HOME: "/srv/app-data" },
  }).data, "/srv/app-data/override/state");

  assert.equal(resolvePaths(paths, {
    platform: "posix",
    home: "/home/user",
    env: { APP_DATA_HOME: "relative/app-data" },
  }).data, "/home/user/.local/share/cli-canon/state");

  assert.equal(resolvePaths(paths, {
    platform: "win32",
    home: "C:\\Users\\user",
    env: { LOCALAPPDATA: "D:\\Users\\user\\AppData\\Local" },
  }).data, "D:\\Users\\user\\AppData\\Local\\cli-canon\\state");

  assert.throws(
    () => compilePaths({
      invalid: { root: { candidates: [{ default: "home" }, { env: "LATE_OVERRIDE" }] } },
    }),
    (error) => error instanceof PathConstructionError &&
      error.issues.some((entry) => entry.code === "INVALID_PATH_ROOT"),
  );
});

test("lexical resolution does not create filesystem paths or read implicit roots", () => {
  const absentRoot = `/tmp/cli-canon-path-${randomUUID()}`;
  const paths = compilePaths(definePaths({
    absent: { root: { path: absentRoot }, kind: "directory" },
  }));

  assert.equal(existsSync(absentRoot), false);
  assert.equal(resolvePaths(paths, { platform: "posix" }).absent, absentRoot);
  assert.equal(existsSync(absentRoot), false);
});

test("invalid path context values fail with structured errors", () => {
  const paths = compilePaths(definePaths({
    project: { root: "home", segments: [{ param: "projectId" }] },
  }));
  assert.throws(
    () => resolvePaths(paths, {
      platform: "posix",
      home: "/home/user",
      parameters: { projectId: 17 },
    }),
    (error) => error instanceof PathResolutionError &&
      error.issues[0]?.code === "INVALID_PATH_PARAMETER",
  );
  assert.throws(
    () => resolvePaths(paths, {
      platform: "posix",
      home: "/home/user",
      parameters: { projectId: "demo" },
      env: null,
    }),
    (error) => error instanceof PathResolutionError &&
      error.issues[0]?.code === "INVALID_PATH_CONTEXT",
  );
});
