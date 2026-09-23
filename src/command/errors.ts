export type CanonConstructionErrorCode =
  | "DUPLICATE_ROUTE"
  | "FLAG_COLLISION"
  | "INVALID_FLAG"
  | "INVALID_ROUTE"
  | "INVALID_PRODUCT_IDENTITY"
  | "INVALID_HANDLER_BINDING"
  | "INVALID_COMMAND_VISIBILITY"
  | "INVALID_PROJECTION"
  | "UNSUPPORTED_SCHEMA_PROJECTION"
  | "INVALID_INPUT_GRAMMAR"
  | "UNSUPPORTED_GRAMMAR";

export interface CanonConstructionIssue {
  readonly code: CanonConstructionErrorCode;
  readonly commandId?: string;
  readonly skillId?: string;
  readonly field?: string;
  readonly fields?: readonly string[];
  readonly message: string;
}

export class CanonConstructionError extends Error {
  readonly code = "CANON_CONSTRUCTION_FAILED" as const;
  readonly issues: readonly CanonConstructionIssue[];

  constructor(issues: readonly CanonConstructionIssue[]) {
    super(issues.map((issue) => issue.message).join("; "));
    this.name = "CanonConstructionError";
    this.issues = Object.freeze(
      issues.map((issue) =>
        Object.freeze({
          ...issue,
          ...(issue.fields === undefined ? {} : { fields: Object.freeze([...issue.fields]) }),
        }),
      ),
    );
  }
}
