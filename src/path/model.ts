/** A root supplied by the consumer when paths are resolved. */
export type PathRoot = "cwd" | "home" | { readonly env: string };

/** One lexical path segment. Separators are deliberately supplied by the platform context. */
export type PathSegments = readonly string[];

export type PathDefinition<Ids extends string = string> =
  | {
      readonly root: PathRoot;
      readonly segments?: PathSegments;
    }
  | {
      readonly parent: Ids;
      readonly segments?: PathSegments;
    };

export type PathCatalog<Ids extends string = string> = Readonly<
  Record<string, PathDefinition<Ids>>
>;

export type PathId<Catalog extends PathCatalog> = Extract<keyof Catalog, string>;

export interface CompiledRootPath<Id extends string = string> {
  readonly id: Id;
  readonly root: PathRoot;
  readonly segments: PathSegments;
}

export interface CompiledParentPath<Id extends string = string> {
  readonly id: Id;
  readonly parent: Id;
  readonly segments: PathSegments;
}

export type CompiledPath<Id extends string = string> =
  | CompiledRootPath<Id>
  | CompiledParentPath<Id>;

/** Runtime declarations after relationship and lexical validation. */
export interface CompiledPaths<Catalog extends PathCatalog = PathCatalog> {
  readonly paths: readonly CompiledPath<PathId<Catalog>>[];
}

export interface PathResolutionContext {
  readonly platform: "posix" | "win32";
  readonly cwd?: string;
  readonly home?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export type ResolvedPaths<Catalog extends PathCatalog> = Readonly<
  { readonly [Id in PathId<Catalog>]: string }
>;
