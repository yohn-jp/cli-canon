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

export interface CompiledDelegateSkillStep<Id extends string = string> {
  readonly kind: "delegate";
  readonly skillId: Id;
  readonly guidance?: string;
}

export type CompiledSkillStep<CommandId extends string = string, Id extends string = string> =
  | CompiledProseSkillStep
  | CompiledCommandSkillStep<CommandId>
  | CompiledDelegateSkillStep<Id>;

export interface CompiledDomainResultReference {
  readonly kind: "domain-result";
  readonly id: string;
}

export interface CompiledSkill<Id extends string = string, CommandId extends string = string> {
  readonly id: Id;
  readonly summary: string;
  readonly intent?: string;
  readonly invariants: readonly string[];
  readonly references: readonly CompiledDomainResultReference[];
  readonly steps: readonly CompiledSkillStep<CommandId, Id>[];
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

/** Validate Skill command and delegation references against the compiled Canon. */
export function compileSkills<const Catalog extends SkillCatalog>(
  catalog: Catalog,
  commands: readonly CompiledCommand[],
): CompiledSkills<Catalog> {
  const commandById = new Map(commands.map((command) => [command.id, command]));
  const skillIds = new Set(Object.keys(catalog));
  const issues: SkillConstructionIssue[] = [];
  const compiled: CompiledSkill[] = [];
  const delegates = new Map<string, string[]>();

  for (const [skillId, definition] of Object.entries(catalog)) {
    const steps: CompiledSkillStep[] = [];
    const delegateIds: string[] = [];
    for (const [stepIndex, step] of definition.steps.entries()) {
      if (step.kind === "prose") {
        steps.push(Object.freeze({ kind: "prose", text: step.text }));
        continue;
      }
      if (step.kind === "delegate") {
        if (!skillIds.has(step.skillId)) {
          issues.push({
            code: "UNKNOWN_SKILL_REFERENCE",
            skillId,
            stepIndex,
            delegateSkillId: step.skillId,
            message: `skill ${skillId} step ${stepIndex}: unknown Skill ID ${step.skillId}`,
          });
        } else {
          delegateIds.push(step.skillId);
        }
        steps.push(Object.freeze({
          kind: "delegate",
          skillId: step.skillId,
          ...(step.guidance === undefined ? {} : { guidance: step.guidance }),
        }));
        continue;
      }

      const command = commandById.get(step.commandId);
      if (command === undefined) {
        issues.push({
          code: "UNKNOWN_COMMAND_REFERENCE",
          skillId,
          stepIndex,
          commandId: step.commandId,
          message: `skill ${skillId} step ${stepIndex}: unknown command ID ${step.commandId}`,
        });
      } else if (command.visibility === "private") {
        issues.push({
          code: "PRIVATE_COMMAND_REFERENCE",
          skillId,
          stepIndex,
          commandId: step.commandId,
          message: `skill ${skillId} step ${stepIndex}: private command ${step.commandId} cannot appear in a public Skill projection`,
        });
      }
      steps.push(Object.freeze({
        kind: "command",
        commandId: step.commandId,
        guidance: step.guidance,
        prerequisites: Object.freeze([...(step.prerequisites ?? [])]),
      }));
    }
    delegates.set(skillId, delegateIds);
    compiled.push(Object.freeze({
      id: skillId,
      summary: definition.summary,
      ...(definition.intent === undefined ? {} : { intent: definition.intent }),
      invariants: Object.freeze([...(definition.invariants ?? [])]),
      references: Object.freeze((definition.references ?? []).map((reference) => Object.freeze({
        kind: "domain-result" as const,
        id: reference.id,
      }))),
      steps: Object.freeze(steps),
    }));
  }

  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (skillId: string, path: readonly string[]): void => {
    if (active.has(skillId)) {
      issues.push({
        code: "SKILL_DELEGATE_CYCLE",
        skillId: path[path.length - 1] ?? skillId,
        delegateSkillId: skillId,
        message: `Skill delegation cycle: ${[...path, skillId].join(" -> ")}`,
      });
      return;
    }
    if (visited.has(skillId)) return;
    active.add(skillId);
    for (const delegateId of delegates.get(skillId) ?? []) visit(delegateId, [...path, skillId]);
    active.delete(skillId);
    visited.add(skillId);
  };
  for (const skillId of skillIds) visit(skillId, []);

  if (issues.length > 0) throw new SkillConstructionError(issues);
  return Object.freeze(compiled) as CompiledSkills<Catalog>;
}
