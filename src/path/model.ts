/** A root supplied by the consumer when paths are resolved. */
export type PathRootSource = "cwd" | "home" | { readonly env: string } | { readonly path: string };

export type PathPlatform = "posix" | "win32";

/** An ordered root candidate. The first available candidate is selected. */
export type PathRootCandidate =
  | {
      readonly env: string;
      /** Ignore a relative environment value and continue to the next candidate. */
      readonly absoluteOnly?: boolean;
      readonly segments?: readonly string[];
    }
  | {
      readonly platform: PathPlatform;
      readonly root: PathRootSource;
      readonly segments?: readonly string[];
    }
  | {
      readonly default: PathRootSource;
      readonly segments?: readonly string[];
    };

/** A root whose selection precedence is the order of its candidates. */
export interface PathRootStrategy {
  readonly candidates: readonly PathRootCandidate[];
}

/** Existing roots remain valid; strategies add explicit fallback precedence. */
export type PathRoot = PathRootSource | PathRootStrategy;

/** A named required value occupying exactly one lexical path component. */
export interface PathParameter<Name extends string = string> {
  readonly param: Name;
}

/** One lexical path segment. Separators are supplied by the platform context. */
export type PathSegment<Name extends string = string> = string | PathParameter<Name>;
export type PathSegments<Name extends string = string> = readonly PathSegment<Name>[];

export type PathKind = "file" | "directory";

export type PathDefinition<Ids extends string = string, Parameters extends string = string> =
  | {
      readonly root: PathRoot;
      readonly segments?: PathSegments<Parameters>;
      readonly kind?: PathKind;
    }
  | {
      readonly parent: Ids;
      readonly segments?: PathSegments<Parameters>;
      readonly kind?: PathKind;
    };

export type PathCatalog<Ids extends string = string, Parameters extends string = string> = Readonly<
  Record<string, PathDefinition<Ids, Parameters>>
>;

export type PathId<Catalog extends PathCatalog> = Extract<keyof Catalog, string>;

type ParameterNameFromSegment<Segment> = Segment extends PathParameter<infer Name> ? Name : never;
type ParameterNamesFromSegments<Segments> = Segments extends readonly (infer Segment)[]
  ? ParameterNameFromSegment<Segment>
  : never;

/** Required parameter names inferred from every path declaration. */
export type PathParameterName<Catalog extends PathCatalog> = {
  [Id in PathId<Catalog>]: ParameterNamesFromSegments<Catalog[Id]["segments"]>;
}[PathId<Catalog>];

/** Required string values for the parameter names inferred from a catalog. */
export type PathParameterValues<Catalog extends PathCatalog> = Readonly<{
  [Name in PathParameterName<Catalog>]: string;
}>;

export interface CompiledRootPath<Id extends string = string> {
  readonly id: Id;
  readonly root: PathRoot;
  readonly segments: PathSegments;
  readonly kind: PathKind;
}

export interface CompiledParentPath<Id extends string = string> {
  readonly id: Id;
  readonly parent: Id;
  readonly segments: PathSegments;
  readonly kind: PathKind;
}

export type CompiledPath<Id extends string = string> = CompiledRootPath<Id> | CompiledParentPath<Id>;

/** Runtime declarations after relationship and lexical validation. */
export interface CompiledPaths<Catalog extends PathCatalog = PathCatalog> {
  readonly paths: readonly CompiledPath<PathId<Catalog>>[];
}

type PathParameterContext<Names extends string> = [Names] extends [never]
  ? { readonly parameters?: Readonly<Record<never, never>> }
  : { readonly parameters: Readonly<Record<Names, string>> };

export type PathResolutionContext<Names extends string = never> = {
  readonly platform: PathPlatform;
  readonly cwd?: string;
  readonly home?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
} & PathParameterContext<Names>;

export type ResolvedPaths<Catalog extends PathCatalog> = Readonly<{ readonly [Id in PathId<Catalog>]: string }>;
