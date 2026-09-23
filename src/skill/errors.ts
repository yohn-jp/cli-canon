interface SkillConstructionIssueBase {
  readonly skillId: string;
  readonly stepIndex?: number;
  readonly commandId?: string;
  readonly delegateSkillId?: string;
  readonly message: string;
}

export type SkillConstructionIssue =
  | (SkillConstructionIssueBase & {
      readonly code: "UNKNOWN_COMMAND_REFERENCE" | "PRIVATE_COMMAND_REFERENCE" | "INVALID_COMMAND_BINDING";
      readonly stepIndex: number;
      readonly commandId: string;
    })
  | (SkillConstructionIssueBase & {
      readonly code: "UNKNOWN_SKILL_REFERENCE";
      readonly stepIndex: number;
      readonly delegateSkillId: string;
    })
  | (SkillConstructionIssueBase & {
      readonly code: "SKILL_DELEGATE_CYCLE";
      readonly delegateSkillId: string;
    })
  | (SkillConstructionIssueBase & {
      readonly code: "INVALID_SKILL_OUTPUT_BUDGET";
    });

export class SkillConstructionError extends Error {
  readonly code = "SKILL_CONSTRUCTION_FAILED" as const;
  readonly issues: readonly SkillConstructionIssue[];

  constructor(issues: readonly SkillConstructionIssue[]) {
    super(issues.map((issue) => issue.message).join("; "));
    this.name = "SkillConstructionError";
    this.issues = Object.freeze([...issues]);
  }
}
