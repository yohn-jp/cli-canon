export interface SkillConstructionIssue {
  readonly code: "UNKNOWN_COMMAND_REFERENCE";
  readonly skillId: string;
  readonly stepIndex: number;
  readonly commandId: string;
  readonly message: string;
}

export class SkillConstructionError extends Error {
  readonly code = "SKILL_CONSTRUCTION_FAILED" as const;
  readonly issues: readonly SkillConstructionIssue[];

  constructor(issues: readonly SkillConstructionIssue[]) {
    super(issues.map((issue) => issue.message).join("; "));
    this.name = "SkillConstructionError";
    this.issues = Object.freeze([...issues]);
  }
}
