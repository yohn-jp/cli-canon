import { PathConstructionError, PathResolutionError, type PathIssue } from "./errors.js";
import type {
  CompiledPath,
  CompiledPaths,
  PathCatalog,
  PathDefinition,
  PathId,
  PathKind,
  PathParameterName,
  PathResolutionContext,
  PathRoot,
  PathRootSource,
  PathRootStrategy,
  PathSegments,
  ResolvedPaths,
} from "./model.js";

/** Preserve path IDs and parent references as literals. */
export function definePaths<const Catalog extends PathCatalog<Extract<keyof Catalog, string>>>(
  paths: Catalog,
): Catalog {
  return paths;
}

function issue(code: PathIssue["code"], pathId: string, message: string): PathIssue {
  return { code, pathId, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validEnvironmentName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !value.includes("=") && !value.includes("\0");
}

function validRootSource(root: unknown): root is PathRootSource {
  if (root === "cwd" || root === "home") return true;
  if (!isRecord(root)) return false;
  const keys = Object.keys(root);
  if (keys.length !== 1) return false;
  if (keys[0] === "env") return validEnvironmentName(root.env);
  return keys[0] === "path" && typeof root.path === "string" && root.path.length > 0 && !root.path.includes("\0");
}

function validStaticSegments(segments: unknown, pathId: string): PathIssue | undefined {
  if (segments === undefined) return undefined;
  if (!Array.isArray(segments)) {
    return issue("INVALID_PATH_SEGMENT", pathId, `${pathId}: segments must be an array of single path components`);
  }
  const values: readonly unknown[] = segments;
  for (const segment of values) {
    if (
      typeof segment !== "string" ||
      segment.length === 0 ||
      segment === "." ||
      segment === ".." ||
      segment.includes("/") ||
      segment.includes("\\") ||
      segment.includes("\0")
    ) {
      return issue(
        "INVALID_PATH_SEGMENT",
        pathId,
        `${pathId}: each root candidate segment must be a non-empty single component without traversal or separators`,
      );
    }
  }
  return undefined;
}

function validSegments(segments: unknown, pathId: string): PathIssue | undefined {
  if (segments === undefined) return undefined;
  if (!Array.isArray(segments)) {
    return issue("INVALID_PATH_SEGMENT", pathId, `${pathId}: segments must be an array of single path components`);
  }
  const values: readonly unknown[] = segments;
  for (const segment of values) {
    if (typeof segment === "string") {
      if (
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment.includes("/") ||
        segment.includes("\\") ||
        segment.includes("\0")
      ) {
        return issue(
          "INVALID_PATH_SEGMENT",
          pathId,
          `${pathId}: each segment must be a non-empty single component without traversal or separators`,
        );
      }
      continue;
    }
    if (!isRecord(segment) || Object.keys(segment).length !== 1 || !Object.hasOwn(segment, "param")) {
      return issue("INVALID_PATH_PARAMETER", pathId, `${pathId}: dynamic segments must contain exactly one param name`);
    }
    if (typeof segment.param !== "string" || segment.param.length === 0 || segment.param.includes("\0")) {
      return issue("INVALID_PATH_PARAMETER", pathId, `${pathId}: parameter names must be non-empty strings`);
    }
  }
  return undefined;
}

function validRootCandidate(candidate: unknown, pathId: string): PathIssue | undefined {
  if (!isRecord(candidate)) {
    return issue("INVALID_PATH_ROOT", pathId, `${pathId}: root candidates must be objects`);
  }
  const keys = Object.keys(candidate);
  if (Object.hasOwn(candidate, "env")) {
    if (
      keys.some((key) => !["env", "absoluteOnly", "segments"].includes(key)) ||
      !validEnvironmentName(candidate.env) ||
      (Object.hasOwn(candidate, "absoluteOnly") && typeof candidate.absoluteOnly !== "boolean")
    ) {
      return issue("INVALID_PATH_ROOT", pathId, `${pathId}: invalid environment root candidate`);
    }
    return validStaticSegments(candidate.segments, pathId);
  }
  if (Object.hasOwn(candidate, "platform")) {
    if (
      keys.some((key) => !["platform", "root", "segments"].includes(key)) ||
      (candidate.platform !== "posix" && candidate.platform !== "win32") ||
      !validRootSource(candidate.root)
    ) {
      return issue("INVALID_PATH_ROOT", pathId, `${pathId}: invalid platform root candidate`);
    }
    return validStaticSegments(candidate.segments, pathId);
  }
  if (Object.hasOwn(candidate, "default")) {
    if (
      keys.some((key) => !["default", "segments"].includes(key)) ||
      !validRootSource(candidate.default)
    ) {
      return issue("INVALID_PATH_ROOT", pathId, `${pathId}: invalid default root candidate`);
    }
    return validStaticSegments(candidate.segments, pathId);
  }
  return issue("INVALID_PATH_ROOT", pathId, `${pathId}: root candidate must select env, platform, or default`);
}

function validRoot(root: unknown, pathId: string): root is PathRoot {
  if (validRootSource(root)) return true;
  if (!isRecord(root) || Object.keys(root).length !== 1 || !Object.hasOwn(root, "candidates")) return false;
  if (!Array.isArray(root.candidates) || root.candidates.length === 0) return false;
  const candidates: readonly unknown[] = root.candidates;
  let defaults = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const candidateIssue = validRootCandidate(candidate, pathId);
    if (candidateIssue !== undefined) return false;
    if (isRecord(candidate) && Object.hasOwn(candidate, "default")) {
      defaults += 1;
      if (index !== candidates.length - 1) return false;
    }
  }
  return defaults <= 1;
}

function rootIssue(root: unknown, pathId: string): PathIssue {
  if (isRecord(root) && Object.hasOwn(root, "candidates") && Array.isArray(root.candidates)) {
    const candidates: readonly unknown[] = root.candidates;
    for (const candidate of candidates) {
      const candidateIssue = validRootCandidate(candidate, pathId);
      if (candidateIssue !== undefined) return candidateIssue;
    }
    if (candidates.length === 0) {
      return issue("INVALID_PATH_ROOT", pathId, `${pathId}: root strategy requires at least one candidate`);
    }
    return issue("INVALID_PATH_ROOT", pathId, `${pathId}: a default root candidate must be the final candidate`);
  }
  return issue("INVALID_PATH_ROOT", pathId, `${pathId}: root must be cwd, home, an environment reference, an absolute path, or an ordered strategy`);
}

function cloneRootSource(root: PathRootSource): PathRootSource {
  return typeof root === "object" ? Object.freeze({ ...root }) : root;
}

function cloneRoot(root: PathRoot): PathRoot {
  if (typeof root === "string" || !("candidates" in root)) return cloneRootSource(root);
  const candidates = root.candidates.map((candidate) => {
    if ("env" in candidate) {
      return Object.freeze({
        env: candidate.env,
        ...(candidate.absoluteOnly === undefined ? {} : { absoluteOnly: candidate.absoluteOnly }),
        ...(candidate.segments === undefined ? {} : { segments: Object.freeze([...candidate.segments]) }),
      });
    }
    if ("platform" in candidate) {
      return Object.freeze({
        platform: candidate.platform,
        root: cloneRootSource(candidate.root),
        ...(candidate.segments === undefined ? {} : { segments: Object.freeze([...candidate.segments]) }),
      });
    }
    return Object.freeze({
      default: cloneRootSource(candidate.default),
      ...(candidate.segments === undefined ? {} : { segments: Object.freeze([...candidate.segments]) }),
    });
  });
  return Object.freeze({ candidates: Object.freeze(candidates) });
}

function compileSegments(segments: PathSegments | undefined): PathSegments {
  return Object.freeze((segments ?? []).map((segment) =>
    typeof segment === "string" ? segment : Object.freeze({ param: segment.param }),
  ));
}

function normalizePosixAbsolute(value: string): string | undefined {
  if (!value.startsWith("/")) return undefined;
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

function normalizeWin32Absolute(value: string): string | undefined {
  const windowsValue = value.replaceAll("/", "\\");
  let root: string;
  let rest: string;
  const drive = /^([A-Za-z]:)\\/u.exec(windowsValue);
  if (drive !== null) {
    root = `${drive[1]}\\`;
    rest = windowsValue.slice(root.length);
  } else {
    const unc = /^\\\\([^\\]+)\\([^\\]+)(?:\\|$)/u.exec(windowsValue);
    if (unc === null) return undefined;
    root = `\\\\${unc[1]}\\${unc[2]}\\`;
    rest = windowsValue.slice(unc[0].length);
  }

  const parts: string[] = [];
  for (const part of rest.split("\\")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.length === 0 ? root : `${root}${parts.join("\\")}`;
}

function normalizeAbsolute(value: string, platform: "posix" | "win32"): string | undefined {
  return platform === "posix" ? normalizePosixAbsolute(value) : normalizeWin32Absolute(value);
}

function appendSegments(base: string, segments: readonly string[], platform: "posix" | "win32"): string {
  const separator = platform === "posix" ? "/" : "\\";
  return segments.reduce(
    (current, segment) => `${current.endsWith(separator) ? current : `${current}${separator}`}${segment}`,
    base,
  );
}

function parameterNames(paths: readonly CompiledPath<string>[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const path of paths) {
    for (const segment of path.segments) {
      if (typeof segment !== "string") names.set(segment.param, path.id);
    }
  }
  return names;
}

/** Validate references and cycles, and freeze a projection of the declarations. */
export function compilePaths<const Catalog extends PathCatalog<Extract<keyof Catalog, string>>>(
  paths: Catalog,
): CompiledPaths<Catalog> {
  const issues: PathIssue[] = [];
  const ids = Object.keys(paths) as PathId<Catalog>[];
  const knownIds = new Set<string>(ids);
  const declarations = new Map<string, PathDefinition<PathId<Catalog>>>();

  for (const id of ids) {
    const declaration = paths[id];
    if (declaration === undefined) {
      issues.push(issue("INVALID_PATH_DECLARATION", id, `${id}: path declaration must be an object`));
      continue;
    }
    const rawDeclaration: unknown = declaration;
    if (id.trim().length === 0) {
      issues.push(issue("INVALID_PATH_ID", id, "Path IDs must not be empty or whitespace"));
      continue;
    }
    if (!isRecord(rawDeclaration)) {
      issues.push(issue("INVALID_PATH_DECLARATION", id, `${id}: path declaration must be an object`));
      continue;
    }

    const hasRoot = Object.hasOwn(rawDeclaration, "root");
    const hasParent = Object.hasOwn(rawDeclaration, "parent");
    if (hasRoot === hasParent) {
      issues.push(issue("INVALID_PATH_DECLARATION", id, `${id}: declare exactly one root or parent`));
      continue;
    }

    const segmentIssue = validSegments(rawDeclaration.segments, id);
    if (segmentIssue !== undefined) issues.push(segmentIssue);
    if (Object.hasOwn(rawDeclaration, "kind") && rawDeclaration.kind !== "file" && rawDeclaration.kind !== "directory") {
      issues.push(issue("INVALID_PATH_KIND", id, `${id}: kind must be file or directory`));
    }

    if (hasRoot && !validRoot(rawDeclaration.root, id)) {
      issues.push(rootIssue(rawDeclaration.root, id));
      continue;
    }
    const parent = rawDeclaration.parent;
    if (hasParent && (typeof parent !== "string" || parent.length === 0)) {
      issues.push(issue("INVALID_PATH_DECLARATION", id, `${id}: parent must be a non-empty path ID`));
      continue;
    }
    declarations.set(id, declaration);
  }

  for (const [id, declaration] of declarations) {
    if ("parent" in declaration && !knownIds.has(declaration.parent)) {
      issues.push(issue("UNKNOWN_PATH_REFERENCE", id, `${id}: references unknown path ${declaration.parent}`));
    }
  }

  const marks = new Map<string, "visiting" | "visited">();
  const stack: string[] = [];
  const cycleIssues = new Set<string>();
  const visit = (id: string): void => {
    const mark = marks.get(id);
    if (mark === "visited") return;
    if (mark === "visiting") {
      const cycleStart = stack.indexOf(id);
      const cycle = [...stack.slice(cycleStart), id];
      const key = cycle.join("\0");
      if (!cycleIssues.has(key)) {
        cycleIssues.add(key);
        issues.push(issue("PATH_CYCLE", id, `Path reference cycle: ${cycle.join(" -> ")}`));
      }
      return;
    }

    const declaration = declarations.get(id);
    if (declaration === undefined) return;
    marks.set(id, "visiting");
    stack.push(id);
    if ("parent" in declaration && knownIds.has(declaration.parent)) visit(declaration.parent);
    stack.pop();
    marks.set(id, "visited");
  };
  for (const id of ids) visit(id);

  if (issues.length > 0) throw new PathConstructionError(issues);

  const compiled: CompiledPath<PathId<Catalog>>[] = [];
  for (const id of ids) {
    const declaration = declarations.get(id);
    if (declaration === undefined) continue;
    const segments = compileSegments(declaration.segments);
    const kind: PathKind = declaration.kind ?? "directory";
    if ("root" in declaration) {
      compiled.push(Object.freeze({ id, root: cloneRoot(declaration.root), segments, kind }));
    } else {
      compiled.push(Object.freeze({ id, parent: declaration.parent, segments, kind }));
    }
  }
  return Object.freeze({ paths: Object.freeze(compiled) });
}

function contextIssue(code: PathIssue["code"], message: string, pathId?: string): PathResolutionError {
  return new PathResolutionError({ code, ...(pathId === undefined ? {} : { pathId }), message });
}

function validateContext(context: unknown): asserts context is PathResolutionContext {
  if (!isRecord(context)) {
    throw contextIssue("INVALID_PATH_CONTEXT", "resolution context must be an object");
  }
  if (context.platform !== "posix" && context.platform !== "win32") {
    throw contextIssue("INVALID_PATH_CONTEXT", "resolution context platform must be posix or win32");
  }
  for (const name of ["cwd", "home"] as const) {
    if (Object.hasOwn(context, name) && typeof context[name] !== "string") {
      throw contextIssue("INVALID_PATH_CONTEXT", `resolution context ${name} must be a string`);
    }
  }
  if (Object.hasOwn(context, "env")) {
    if (!isRecord(context.env)) {
      throw contextIssue("INVALID_PATH_CONTEXT", "resolution context env must be an object");
    }
    for (const [name, value] of Object.entries(context.env)) {
      if (value !== undefined && typeof value !== "string") {
        throw contextIssue("INVALID_PATH_CONTEXT", `resolution context env.${name} must be a string`);
      }
    }
  }
  if (Object.hasOwn(context, "parameters")) {
    if (!isRecord(context.parameters)) {
      throw contextIssue("INVALID_PATH_CONTEXT", "resolution context parameters must be an object");
    }
    for (const [name, value] of Object.entries(context.parameters)) {
      if (typeof value !== "string") {
        throw contextIssue("INVALID_PATH_PARAMETER", `path parameter ${name} must be a string`);
      }
    }
  }
}

function environmentValue(context: PathResolutionContext, name: string): string | undefined {
  const environment = context.env;
  return environment !== undefined && Object.hasOwn(environment, name) ? environment[name] : undefined;
}

function rootSourceValue(
  source: PathRootSource,
  context: PathResolutionContext,
  pathId: string,
  missing: "skip" | "error",
): string | undefined {
  let value: unknown;
  let sourceName: string;
  if (source === "cwd" || source === "home") {
    sourceName = source;
    value = context[source];
  } else if ("env" in source) {
    sourceName = `env.${source.env}`;
    value = environmentValue(context, source.env);
  } else {
    sourceName = "declared path";
    value = source.path;
  }
  if (value === undefined || value === "") {
    if (missing === "skip") return undefined;
    throw contextIssue("MISSING_PATH_CONTEXT", `${pathId}: resolution context does not provide ${sourceName}`, pathId);
  }
  if (typeof value !== "string") {
    throw contextIssue("INVALID_PATH_CONTEXT", `${pathId}: path root in resolution context must be a string`, pathId);
  }
  const normalized = normalizeAbsolute(value, context.platform);
  if (normalized === undefined) {
    throw contextIssue(
      "INVALID_PATH_ROOT",
      `${pathId}: ${sourceName} must be an absolute ${context.platform} path`,
      pathId,
    );
  }
  return normalized;
}

function strategyRoot(
  strategy: PathRootStrategy,
  context: PathResolutionContext,
  pathId: string,
): { readonly root: string; readonly segments: readonly string[] } {
  for (const candidate of strategy.candidates) {
    if ("env" in candidate) {
      const value: unknown = environmentValue(context, candidate.env);
      if (value === undefined || value === "") continue;
      if (typeof value !== "string") {
        throw contextIssue("INVALID_PATH_CONTEXT", `${pathId}: env.${candidate.env} must be a string`, pathId);
      }
      const normalized = normalizeAbsolute(value, context.platform);
      if (normalized === undefined) {
        if (candidate.absoluteOnly === true) continue;
        throw contextIssue(
          "INVALID_PATH_ROOT",
          `${pathId}: env.${candidate.env} must be an absolute ${context.platform} path`,
          pathId,
        );
      }
      return { root: normalized, segments: candidate.segments ?? [] };
    }
    if ("platform" in candidate) {
      if (candidate.platform !== context.platform) continue;
      const value = rootSourceValue(candidate.root, context, pathId, "skip");
      if (value === undefined) continue;
      return { root: value, segments: candidate.segments ?? [] };
    }
    const value = rootSourceValue(candidate.default, context, pathId, "error");
    if (value !== undefined) return { root: value, segments: candidate.segments ?? [] };
  }
  throw contextIssue(
    "MISSING_PATH_CONTEXT",
    `${pathId}: no root strategy candidate applies to the resolution context`,
    pathId,
  );
}

type ExactParameterContext<Names extends string, Context> = Context extends { readonly parameters: infer Parameters }
  ? Parameters extends object
    ? Record<Exclude<keyof Parameters, Names>, never>
    : never
  : Record<never, never>;

/** Resolve addresses using only explicitly supplied context and lexical operations. */
export function resolvePaths<
  const Catalog extends PathCatalog,
  const Context extends PathResolutionContext<PathParameterName<Catalog>> = PathResolutionContext<PathParameterName<Catalog>>,
>(
  paths: CompiledPaths<Catalog>,
  context: Context & ExactParameterContext<PathParameterName<Catalog>, Context>,
): ResolvedPaths<Catalog> {
  validateContext(context);
  const byId = new Map<string, CompiledPath<string>>();
  for (const path of paths.paths) byId.set(path.id, path);

  const requiredParameters = parameterNames(paths.paths);
  const rawParameters: unknown = context.parameters;
  const suppliedParameters = isRecord(rawParameters) ? rawParameters : {};
  const resolvedParameters = new Map<string, string>();
  for (const name of requiredParameters.keys()) {
    const value = Object.hasOwn(suppliedParameters, name) ? suppliedParameters[name] : undefined;
    if (value === undefined) {
      throw contextIssue("MISSING_PATH_PARAMETER", `missing required path parameter ${name}`, requiredParameters.get(name));
    }
    if (typeof value !== "string") {
      throw contextIssue("INVALID_PATH_PARAMETER", `path parameter ${name} must be a string`, requiredParameters.get(name));
    }
    if (
      value.length === 0 ||
      value === "." ||
      value === ".." ||
      value.includes("/") ||
      value.includes("\\") ||
      value.includes("\0")
    ) {
      throw contextIssue(
        "INVALID_PATH_PARAMETER",
        `path parameter ${name} must be a non-empty single path component`,
        requiredParameters.get(name),
      );
    }
    resolvedParameters.set(name, value);
  }
  for (const name of Object.keys(suppliedParameters)) {
    if (!requiredParameters.has(name)) {
      throw contextIssue("UNKNOWN_PATH_PARAMETER", `unknown path parameter ${name}`);
    }
  }

  const resolved = new Map<string, string>();
  const visiting = new Set<string>();
  const resolve = (id: string): string => {
    const cached = resolved.get(id);
    if (cached !== undefined) return cached;
    const definition = byId.get(id);
    if (definition === undefined) {
      throw contextIssue("UNKNOWN_PATH_REFERENCE", `${id}: references unknown path`, id);
    }
    if (visiting.has(id)) {
      throw contextIssue("PATH_CYCLE", `${id}: path reference cycle during resolution`, id);
    }
    visiting.add(id);

    let base: string;
    let candidateSegments: readonly string[] = [];
    if ("root" in definition) {
      if (typeof definition.root !== "string" && "candidates" in definition.root) {
        const selected = strategyRoot(definition.root, context, id);
        base = selected.root;
        candidateSegments = selected.segments;
      } else {
        const selected = rootSourceValue(definition.root, context, id, "error");
        if (selected === undefined) {
          throw contextIssue("MISSING_PATH_CONTEXT", `${id}: root context is missing`, id);
        }
        base = selected;
      }
    } else {
      base = resolve(definition.parent);
    }

    const candidateBase = appendSegments(base, candidateSegments, context.platform);
    const segments = definition.segments.map((segment) =>
      typeof segment === "string" ? segment : resolvedParameters.get(segment.param)!,
    );
    const result = appendSegments(candidateBase, segments, context.platform);
    visiting.delete(id);
    resolved.set(id, result);
    return result;
  };

  for (const path of paths.paths) resolve(path.id);

  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [id, value] of resolved) result[id] = value;
  return Object.freeze(result) as ResolvedPaths<Catalog>;
}
