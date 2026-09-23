import { PathConstructionError, PathResolutionError, type PathIssue } from "./errors.js";
import type {
  CompiledPath,
  CompiledPaths,
  PathCatalog,
  PathDefinition,
  PathId,
  PathResolutionContext,
  PathRoot,
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

function validRoot(root: unknown): root is PathRoot {
  if (root === "cwd" || root === "home") return true;
  if (root === null || typeof root !== "object" || Array.isArray(root)) return false;
  const keys = Object.keys(root);
  return keys.length === 1 && keys[0] === "env" &&
    typeof (root as { readonly env?: unknown }).env === "string" &&
    (root as { readonly env: string }).env.length > 0 &&
    !(root as { readonly env: string }).env.includes("=") &&
    !(root as { readonly env: string }).env.includes("\0");
}

function validSegments(segments: unknown, pathId: string): PathIssue | undefined {
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
        `${pathId}: each segment must be a non-empty single component without traversal or separators`,
      );
    }
  }
  return undefined;
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
    if (id.trim().length === 0) {
      issues.push(issue("INVALID_PATH_ID", id, "Path IDs must not be empty or whitespace"));
      continue;
    }
    if (declaration === null || typeof declaration !== "object" || Array.isArray(declaration)) {
      issues.push(issue("INVALID_PATH_DECLARATION", id, `${id}: path declaration must be an object`));
      continue;
    }

    const hasRoot = Object.hasOwn(declaration, "root");
    const hasParent = Object.hasOwn(declaration, "parent");
    if (hasRoot === hasParent) {
      issues.push(issue("INVALID_PATH_DECLARATION", id, `${id}: declare exactly one root or parent`));
      continue;
    }

    const segmentIssue = validSegments(declaration.segments, id);
    if (segmentIssue !== undefined) issues.push(segmentIssue);

    if (hasRoot && !validRoot((declaration as { readonly root?: unknown }).root)) {
      issues.push(issue("INVALID_PATH_ROOT", id, `${id}: root must be cwd, home, or an environment variable reference`));
      continue;
    }
    const parent = (declaration as { readonly parent?: unknown }).parent;
    if (hasParent && (typeof parent !== "string" || parent.length === 0)) {
      issues.push(issue("INVALID_PATH_DECLARATION", id, `${id}: parent must be a non-empty path ID`));
      continue;
    }
    declarations.set(id, declaration as PathDefinition<PathId<Catalog>>);
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
    const segments = Object.freeze([...(declaration.segments ?? [])]);
    if ("root" in declaration) {
      const root = typeof declaration.root === "object"
        ? Object.freeze({ env: declaration.root.env })
        : declaration.root;
      compiled.push(Object.freeze({ id, root, segments }));
    } else {
      compiled.push(Object.freeze({ id, parent: declaration.parent, segments }));
    }
  }
  return Object.freeze({ paths: Object.freeze(compiled) });
}

/** Resolve addresses using only the explicitly supplied lexical context. */
export function resolvePaths<const Catalog extends PathCatalog>(
  paths: CompiledPaths<Catalog>,
  context: PathResolutionContext,
): ResolvedPaths<Catalog> {
  if (context.platform !== "posix" && context.platform !== "win32") {
    throw new PathResolutionError({
      code: "INVALID_PATH_CONTEXT",
      message: "resolution context platform must be posix or win32",
    });
  }
  const byId = new Map<string, CompiledPath<string>>();
  for (const path of paths.paths) byId.set(path.id, path);

  const resolved = new Map<string, string>();
  const visiting = new Set<string>();
  const resolve = (id: string): string => {
    const cached = resolved.get(id);
    if (cached !== undefined) return cached;
    const definition = byId.get(id);
    if (definition === undefined) {
      throw new PathResolutionError(issue("UNKNOWN_PATH_REFERENCE", id, `${id}: references unknown path`));
    }
    if (visiting.has(id)) {
      throw new PathResolutionError(issue("PATH_CYCLE", id, `${id}: path reference cycle during resolution`));
    }
    visiting.add(id);

    let base: string;
    let rootValue: unknown;
    if ("root" in definition) {
      if (definition.root === "cwd") rootValue = context.cwd;
      else if (definition.root === "home") rootValue = context.home;
      else rootValue = context.env?.[definition.root.env];
      if (rootValue === undefined || rootValue === "") {
        const rootName = definition.root === "cwd" || definition.root === "home"
          ? definition.root
          : `env.${definition.root.env}`;
        throw new PathResolutionError(issue(
          "MISSING_PATH_CONTEXT",
          id,
          `${id}: resolution context does not provide ${rootName}`,
        ));
      }
      if (typeof rootValue !== "string") {
        throw new PathResolutionError(issue(
          "INVALID_PATH_CONTEXT",
          id,
          `${id}: path root in resolution context must be a string`,
        ));
      }
      const normalized = normalizeAbsolute(rootValue, context.platform);
      if (normalized === undefined) {
        throw new PathResolutionError(issue(
          "INVALID_PATH_ROOT",
          id,
          `${id}: ${definition.root === "cwd" || definition.root === "home" ? definition.root : `env.${definition.root.env}`} must be an absolute ${context.platform} path`,
        ));
      }
      base = normalized;
    } else {
      base = resolve(definition.parent);
    }

    const result = appendSegments(base, definition.segments, context.platform);
    visiting.delete(id);
    resolved.set(id, result);
    return result;
  };

  for (const path of paths.paths) resolve(path.id);

  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [id, value] of resolved) result[id] = value;
  return Object.freeze(result) as ResolvedPaths<Catalog>;
}
