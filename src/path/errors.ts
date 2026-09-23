export type PathIssueCode =
  | "INVALID_PATH_ID"
  | "INVALID_PATH_DECLARATION"
  | "INVALID_PATH_ROOT"
  | "INVALID_PATH_SEGMENT"
  | "UNKNOWN_PATH_REFERENCE"
  | "PATH_CYCLE"
  | "MISSING_PATH_CONTEXT"
  | "INVALID_PATH_CONTEXT";

export interface PathIssue {
  readonly code: PathIssueCode;
  readonly pathId?: string;
  readonly message: string;
}

export class PathConstructionError extends Error {
  readonly code = "PATH_CONSTRUCTION_FAILED" as const;
  readonly issues: readonly PathIssue[];

  constructor(issues: readonly PathIssue[]) {
    super(issues.map((issue) => issue.message).join("; "));
    this.name = "PathConstructionError";
    this.issues = Object.freeze([...issues]);
  }
}

export class PathResolutionError extends Error {
  readonly code = "PATH_RESOLUTION_FAILED" as const;
  readonly issues: readonly PathIssue[];

  constructor(issue: PathIssue) {
    super(issue.message);
    this.name = "PathResolutionError";
    this.issues = Object.freeze([Object.freeze(issue)]);
  }
}
