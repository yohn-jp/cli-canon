import type { CompiledCommand } from "../command/compiler.js";
import type { SkillCatalog, SkillId } from "./model.js";
import { SkillConstructionError, type SkillConstructionIssue } from "./errors.js";

export interface CompiledProseSkillStep {
  readonly kind: "prose";
  readonly text: string;
}

export interface CompiledCommandSkillStep<CommandId extends string = string> {
  readonly kind: "command";
  readonly commandId: CommandId;
  readonly guidance: string;
  readonly prerequisites: readonly string[];
}

export type CompiledSkillStep<CommandId extends string = string> =
  | CompiledProseSkillStep
  | CompiledCommandSkillStep<CommandId>;

export interface CompiledSkill<Id extends string = string, CommandId extends string = string> {
  readonly id: Id;
  readonly summary: string;
  readonly steps: readonly CompiledSkillStep<CommandId>[];
}

type ReferencedCommandId<Step> = Step extends { readonly kind: "command"; readonly commandId: infer Id extends string }
  ? Id
  : never;

export type SkillCommandId<Catalog extends SkillCatalog> = Catalog[SkillId<Catalog>] extends infer Definition
  ? Definition extends { readonly steps: readonly (infer Step)[] }
    ? ReferencedCommandId<Step>
    : never
  : never;

export type CompiledSkills<Catalog extends SkillCatalog> = readonly CompiledSkill<
  SkillId<Catalog>,
  SkillCommandId<Catalog>
>[];

/** Validate Skill command references against the compiled Command Canon. */
export function compileSkills<const Catalog extends SkillCatalog>(
  catalog: Catalog,
  commands: readonly CompiledCommand[],
): CompiledSkills<Catalog> {
  const commandIds = new Set(commands.map((command) => command.id));
  const issues: SkillConstructionIssue[] = [];
  const compiled: CompiledSkill[] = [];

  for (const [skillId, definition] of Object.entries(catalog)) {
    const steps: CompiledSkillStep[] = [];
    for (const [stepIndex, step] of definition.steps.entries()) {
      if (step.kind === "prose") {
        steps.push(Object.freeze({ kind: "prose", text: step.text }));
        continue;
      }

      if (!commandIds.has(step.commandId)) {
        issues.push({
          code: "UNKNOWN_COMMAND_REFERENCE",
          skillId,
          stepIndex,
          commandId: step.commandId,
          message: `skill ${skillId} step ${stepIndex}: unknown command ID ${step.commandId}`,
        });
      }
      steps.push(Object.freeze({
        kind: "command",
        commandId: step.commandId,
        guidance: step.guidance,
        prerequisites: Object.freeze([...(step.prerequisites ?? [])]),
      }));
    }
    compiled.push(Object.freeze({
      id: skillId,
      summary: definition.summary,
      steps: Object.freeze(steps),
    }));
  }

  if (issues.length > 0) throw new SkillConstructionError(issues);
  return Object.freeze(compiled) as CompiledSkills<Catalog>;
}
