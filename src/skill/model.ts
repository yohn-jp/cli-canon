export interface ProseSkillStep {
  readonly kind: "prose";
  readonly text: string;
}

export interface CommandSkillStep<CommandId extends string = string> {
  readonly kind: "command";
  readonly commandId: CommandId;
  readonly guidance: string;
  readonly prerequisites?: readonly string[];
}

export interface DelegateSkillStep<SkillId extends string = string> {
  readonly kind: "delegate";
  readonly skillId: SkillId;
  readonly guidance?: string;
}

export type SkillStep<CommandId extends string = string, DelegatedSkillId extends string = string> =
  | ProseSkillStep
  | CommandSkillStep<CommandId>
  | DelegateSkillStep<DelegatedSkillId>;

export interface DomainResultReference {
  readonly kind: "domain-result";
  readonly id: string;
}

export interface SkillDefinition<CommandId extends string = string, DelegatedSkillId extends string = string> {
  readonly summary: string;
  readonly intent?: string;
  readonly invariants?: readonly string[];
  /** References product-owned results; CLI Canon does not interpret their meaning. */
  readonly references?: readonly DomainResultReference[];
  readonly steps: readonly SkillStep<CommandId, DelegatedSkillId>[];
}

export type SkillCatalog<CommandId extends string = string, DelegatedSkillId extends string = string> = Readonly<
  Record<string, SkillDefinition<CommandId, DelegatedSkillId>>
>;

export type SkillId<Catalog extends SkillCatalog> = Extract<keyof Catalog, string>;

/** Preserve Skill IDs, command references, and step text as declaration literals. */
export function defineSkills<const Catalog extends SkillCatalog>(catalog: Catalog): Catalog {
  return catalog;
}
