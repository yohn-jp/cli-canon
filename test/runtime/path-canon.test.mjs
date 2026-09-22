import assert from "node:assert/strict";
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
