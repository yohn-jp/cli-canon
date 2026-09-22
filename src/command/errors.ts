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

/** Pure construction failure: no command handler has run when this is thrown. */
export declare class CanonConstructionError extends Error {
  readonly code: "CANON_CONSTRUCTION_FAILED";
  readonly issues: readonly CanonConstructionIssue[];
}
