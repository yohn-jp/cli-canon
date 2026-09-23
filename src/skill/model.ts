import type { CommandCatalog, CommandId } from "../command/model.js";
import type { InvocationBindings } from "../projection/invocation.js";

export const DEFAULT_SKILL_OUTPUT_BUDGET_BYTES = 4096;
export const MIN_SKILL_OUTPUT_BUDGET_BYTES = "OUTPUT_BUDGET_EXCEEDED\n".length;

export interface ProseSkillStep {
  readonly kind: "prose";
  readonly text: string;
}

export interface CommandSkillStep<
  CommandId extends string = string,
  Bindings extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>,
> {
  readonly kind: "command";
  readonly commandId: CommandId;
  readonly guidance: string;
  readonly prerequisites?: readonly string[];
  readonly bindings?: Bindings;
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
  readonly outputBudgetBytes?: number;
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

/** Author a command Skill step with bindings typed from the referenced Command Canon. */
export function skillCommand<
  const Commands extends CommandCatalog,
  const Id extends CommandId<Commands>,
>(
  commands: Commands,
  commandId: Id,
  config: {
    readonly guidance: string;
    readonly prerequisites?: readonly string[];
    readonly bindings?: InvocationBindings<Commands[Id]>;
  },
): CommandSkillStep<Id, InvocationBindings<Commands[Id]>> {
  void commands;
  return Object.freeze({
    kind: "command" as const,
    commandId,
    guidance: config.guidance,
    ...(config.prerequisites === undefined
      ? {}
      : { prerequisites: Object.freeze([...config.prerequisites]) }),
    ...(config.bindings === undefined
      ? {}
      : {
          bindings: Object.freeze(Object.fromEntries(
            Object.entries(config.bindings).map(([key, value]) => [
              key,
              Array.isArray(value) ? Object.freeze([...value]) : value,
            ]),
          )) as InvocationBindings<Commands[Id]>,
        }),
  });
}
