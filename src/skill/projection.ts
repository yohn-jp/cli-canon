import type { CompiledProduct } from "../command/compiler.js";
import type { CommandCatalog } from "../command/model.js";
import { renderHelp } from "../projection/help.js";
import type { CompiledSkillStep, CompiledSkills, SkillCommandId } from "./compiler.js";
import type { SkillCatalog, SkillId } from "./model.js";
import type { JsonOutputPolicyOptions, OutputPolicyOptions } from "../output/model.js";
import { OutputPolicyError } from "../output/errors.js";
import { jsonOutput, textOutput } from "../output/policy.js";

export interface SkillProjectionProduct<
  Catalog extends CommandCatalog,
  Skills extends SkillCatalog,
> extends CompiledProduct<Catalog> {
  readonly skills: CompiledSkills<Skills>;
}

export type ProjectedSkillStep<CommandId extends string = string> =
  | { readonly kind: "prose"; readonly text: string }
  | {
      readonly kind: "command";
      readonly commandId: CommandId;
      readonly guidance: string;
      readonly prerequisites: readonly string[];
      readonly route: readonly string[];
      readonly usage: string;
      readonly help: { readonly commandId: CommandId };
      readonly invocation:
        | { readonly state: "ready"; readonly route: readonly string[] }
        | {
            readonly state: "requires-input";
            readonly route: readonly string[];
            readonly requirements: readonly (
              | { readonly kind: "field"; readonly name: string }
              | { readonly kind: "prerequisite"; readonly text: string }
            )[];
          };
    };

export interface ProjectedSkill<Id extends string = string, CommandId extends string = string> {
  readonly id: Id;
  readonly summary: string;
  readonly steps: readonly ProjectedSkillStep<CommandId>[];
}

function projectedStep<const Catalog extends CommandCatalog, CommandId extends string>(
  product: CompiledProduct<Catalog>,
  step: CompiledSkillStep<CommandId>,
): ProjectedSkillStep<CommandId> {
  if (step.kind === "prose") return { kind: "prose", text: step.text };

  const command = product.commands.find((candidate) => String(candidate.id) === step.commandId);
  if (command === undefined) {
    throw new Error(`skill command reference is missing from compiled product: ${step.commandId}`);
  }

  const usageLine = renderHelp(product, { kind: "command", commandId: command.id }).split("\n", 1)[0] ?? "";
  const usage = usageLine.startsWith("Usage: ") ? usageLine.slice("Usage: ".length) : usageLine;
  const requirements = [
    ...command.fields
      .filter((field) => field.kind === "positional" || (field.kind === "option" && field.required === true))
      .map((field) => ({ kind: "field" as const, name: field.key })),
    ...step.prerequisites.map((text) => ({ kind: "prerequisite" as const, text })),
  ];
  const route = [...command.route];
  return {
    kind: "command",
    commandId: step.commandId,
    guidance: step.guidance,
    prerequisites: [...step.prerequisites],
    route,
    usage,
    help: { commandId: step.commandId },
    invocation: requirements.length === 0
      ? { state: "ready", route }
      : { state: "requires-input", route, requirements },
  };
}

export function projectSkill<
  const Catalog extends CommandCatalog,
  const Skills extends SkillCatalog,
>(
  product: SkillProjectionProduct<Catalog, Skills>,
  skillId: SkillId<Skills>,
): ProjectedSkill<SkillId<Skills>, SkillCommandId<Skills>> {
  const skill = product.skills.find((candidate) => candidate.id === skillId);
  if (skill === undefined) throw new Error(`unknown Skill ID: ${skillId}`);
  return {
    id: skill.id,
    summary: skill.summary,
    steps: skill.steps.map((step) => projectedStep(product, step)),
  };
}

export function projectSkills<
  const Catalog extends CommandCatalog,
  const Skills extends SkillCatalog,
>(product: SkillProjectionProduct<Catalog, Skills>): readonly ProjectedSkill<SkillId<Skills>, SkillCommandId<Skills>>[] {
  return product.skills.map((skill) => projectSkill(product, skill.id));
}

function requireOutput(output: ReturnType<typeof textOutput>): string {
  if (output.status === "success") return output.output;
  if (output.failureKind === "serialization" || output.failureKind === "budget") {
    throw new OutputPolicyError(output.failureKind, output.output.trimEnd() || output.failureKind);
  }
  throw new Error(`unexpected Skill output failure: ${output.failureKind}`);
}

export function renderSkillText(skill: ProjectedSkill, options: OutputPolicyOptions = {}): string {
  const lines = [skill.summary, ""];
  for (const step of skill.steps) {
    if (step.kind === "prose") {
      lines.push(step.text, "");
      continue;
    }
    lines.push(step.guidance, `Run: ${step.usage}`);
    if (step.invocation.state === "requires-input") {
      const fields = step.invocation.requirements
        .filter((requirement) => requirement.kind === "field")
        .map((requirement) => requirement.name);
      const prerequisites = step.invocation.requirements
        .filter((requirement) => requirement.kind === "prerequisite")
        .map((requirement) => requirement.text);
      if (fields.length > 0) lines.push(`Requires input: ${fields.join(", ")}`);
      if (prerequisites.length > 0) lines.push(`Requires prerequisites: ${prerequisites.join("; ")}`);
    }
    lines.push(`Help: ${step.help.commandId}`, "");
  }
  return requireOutput(textOutput(`${lines.join("\n").trimEnd()}\n`, options));
}

export function renderSkillJson(skill: ProjectedSkill, options: JsonOutputPolicyOptions = {}): string {
  const policy = options.space === undefined
    ? { ...options, space: 2 }
    : options;
  return requireOutput(jsonOutput(skill, policy));
}
