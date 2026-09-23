import {
  compilePaths,
  definePaths,
  resolvePaths,
  type PathId,
  type PathParameterName,
  type PathResolutionContext,
} from "../../src/path/index.js";
import { bindHandlers, compileProduct } from "../../src/command/compiler.js";
import { defineCommands } from "../../src/command/commands.js";

const paths = definePaths({
  appRoot: { root: "home", segments: [".local", "share", "app"] },
  cache: { parent: "appRoot", segments: ["cache"] },
  envRoot: { root: { env: "APP_DATA" } },
  report: {
    parent: "appRoot",
    segments: ["projects", { param: "projectId" }, "report.json"],
    kind: "file",
  },
  project: {
    root: {
      candidates: [
        { env: "APP_DATA_HOME", absoluteOnly: true },
        { platform: "win32", root: { env: "LOCALAPPDATA" }, segments: ["cli-canon"] },
        { default: "home", segments: [".local", "share", "cli-canon"] },
      ],
    },
    segments: ["projects", { param: "projectId" }],
  },
});

type Id = PathId<typeof paths>;
const validId: Id = "cache";
void validId;
// @ts-expect-error Path IDs are derived from the declaration keys.
const invalidId: Id = "missing";
void invalidId;

type RequiredParameter = PathParameterName<typeof paths>;
const validParameter: RequiredParameter = "projectId";
void validParameter;
// @ts-expect-error Required parameter names are derived from path declarations.
const invalidParameter: RequiredParameter = "workspaceId";
void invalidParameter;

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
  parameters: { projectId: "invoice-17" },
});
resolved.cache satisfies string;
// @ts-expect-error Resolved path keys are derived from declarations.
resolved.missing satisfies string;

const commands = defineCommands({});
const product = compileProduct({
  name: "path-fixture",
  commands,
  handlers: bindHandlers(commands)({}),
  paths,
});
resolvePaths(product.paths, {
  platform: "posix",
  home: "/home/user",
  parameters: { projectId: "invoice-17" },
});
const typedContext: PathResolutionContext<"projectId"> = {
  platform: "posix",
  home: "/home/user",
  parameters: { projectId: "invoice-17" },
};
resolvePaths(compiled, typedContext);

// @ts-expect-error Every declared path parameter is required for resolution.
resolvePaths(compiled, { platform: "posix", home: "/home/user" });

const extraParameters = {
  platform: "posix",
  home: "/home/user",
  parameters: { projectId: "invoice-17", extra: "unreferenced" },
};
// @ts-expect-error Parameter values cannot contain names absent from the declarations.
resolvePaths(compiled, extraParameters);
