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

export type SkillStep<CommandId extends string = string> =
  | ProseSkillStep
  | CommandSkillStep<CommandId>;

export interface SkillDefinition<CommandId extends string = string> {
  readonly summary: string;
  readonly steps: readonly SkillStep<CommandId>[];
}

export type SkillCatalog<CommandId extends string = string> = Readonly<
  Record<string, SkillDefinition<CommandId>>
>;

export type SkillId<Catalog extends SkillCatalog> = Extract<keyof Catalog, string>;

/** Preserve Skill IDs, command references, and step text as declaration literals. */
export function defineSkills<const Catalog extends SkillCatalog>(catalog: Catalog): Catalog {
  return catalog;
}
