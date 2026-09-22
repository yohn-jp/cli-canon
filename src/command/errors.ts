export type CanonConstructionErrorCode =
  | "DUPLICATE_ROUTE"
  | "FLAG_COLLISION"
  | "INVALID_FLAG"
  | "INVALID_ROUTE"
  | "INVALID_INPUT_GRAMMAR"
  | "UNSUPPORTED_GRAMMAR";

export interface CanonConstructionIssue {
  readonly code: CanonConstructionErrorCode;
  readonly commandId?: string;
  readonly field?: string;
  readonly message: string;
}

export class CanonConstructionError extends Error {
  readonly code = "CANON_CONSTRUCTION_FAILED" as const;
  readonly issues: readonly CanonConstructionIssue[];

  constructor(issues: readonly CanonConstructionIssue[]) {
    super(issues.map((issue) => issue.message).join("; "));
    this.name = "CanonConstructionError";
    this.issues = Object.freeze([...issues]);
  }
}
