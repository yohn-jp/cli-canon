import {
  compilePaths,
  definePaths,
  resolvePaths,
  type PathId,
} from "../../src/path/index.js";

const paths = definePaths({
  appRoot: { root: "home", segments: [".local", "share", "app"] },
  cache: { parent: "appRoot", segments: ["cache"] },
  envRoot: { root: { env: "APP_DATA" } },
});

type Id = PathId<typeof paths>;
const validId: Id = "cache";
void validId;
// @ts-expect-error Path IDs are derived from the declaration keys.
const invalidId: Id = "missing";
void invalidId;

definePaths({
  appRoot: { root: "cwd" },
  // @ts-expect-error Parent references must name a declared path.
  missingParent: { parent: "missing" },
});

const compiled = compilePaths(paths);
const resolved = resolvePaths(compiled, {
  platform: "posix",
  cwd: "/work/app",
  home: "/home/user",
  env: { APP_DATA: "/var/lib/app" },
});
resolved.cache satisfies string;
// @ts-expect-error Resolved path keys are derived from declarations.
resolved.missing satisfies string;
