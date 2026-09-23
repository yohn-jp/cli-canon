import type { CompiledProduct } from "../command/compiler.js";
import type { CommandCatalog, CommandId } from "../command/model.js";
import { renderHelp } from "../projection/help.js";
import {
  projectInvocation,
  type CliInvocation,
  type InvocationRequirement,
} from "../projection/invocation.js";
import type { CompiledSkillStep, CompiledSkills, SkillCommandId } from "./compiler.js";
import {
  MIN_SKILL_OUTPUT_BUDGET_BYTES,
  type SkillCatalog,
  type SkillId,
} from "./model.js";
import type { JsonOutputPolicyOptions, OutputPolicyOptions } from "../output/model.js";
import { OutputPolicyError } from "../output/errors.js";
import { jsonOutput, textOutput } from "../output/policy.js";

export interface SkillProjectionProduct<
  Catalog extends CommandCatalog,
  Skills extends SkillCatalog,
> extends CompiledProduct<Catalog> {
  readonly skills: CompiledSkills<Skills>;
}

export type SkillInvocationRequirement =
  | InvocationRequirement
  | { readonly kind: "prerequisite"; readonly text: string };

export type ProjectedSkillStep<CommandId extends string = string, Id extends string = string> =
  | { readonly kind: "prose"; readonly text: string }
  | { readonly kind: "delegate"; readonly skillId: Id; readonly guidance?: string }
  | {
      readonly kind: "command";
      readonly commandId: CommandId;
      readonly guidance: string;
      readonly prerequisites: readonly string[];
      readonly route: readonly string[];
      readonly usage: string;
      readonly help: { readonly commandId: CommandId };
      readonly invocation:
        | { readonly state: "ready"; readonly commandId: CommandId; readonly value: CliInvocation }
        | {
            readonly state: "requires-input";
            readonly commandId: CommandId;
            readonly executable: string;
            readonly route: readonly string[];
            readonly requirements: readonly SkillInvocationRequirement[];
          };
    };

export interface ProjectedSkill<Id extends string = string, CommandId extends string = string> {
  readonly id: Id;
  readonly summary: string;
  readonly intent?: string;
  readonly invariants?: readonly string[];
  readonly references?: readonly { readonly kind: "domain-result"; readonly id: string }[];
  readonly outputBudgetBytes: number;
  readonly steps: readonly ProjectedSkillStep<CommandId, Id>[];
}

function projectedStep<const Catalog extends CommandCatalog, StepCommandId extends string, Id extends string>(
  product: CompiledProduct<Catalog>,
  step: CompiledSkillStep<StepCommandId, Id>,
): ProjectedSkillStep<StepCommandId, Id> {
  if (step.kind === "prose") return { kind: "prose", text: step.text };
  if (step.kind === "delegate") return {
    kind: "delegate",
    skillId: step.skillId,
    ...(step.guidance === undefined ? {} : { guidance: step.guidance }),
  };

  const command = product.commands.find((candidate) => String(candidate.id) === step.commandId);
  if (command === undefined) {
    throw new Error(`skill command reference is missing from compiled product: ${step.commandId}`);
  }

  const usageLine = renderHelp(product, { kind: "command", commandId: command.id }).split("\n", 1)[0] ?? "";
  const usage = usageLine.startsWith("Usage: ") ? usageLine.slice("Usage: ".length) : usageLine;
  const projectedInvocation = projectInvocation(
    product,
    command.id as CommandId<Catalog>,
    step.bindings as never,
  );
  const prerequisiteRequirements = step.prerequisites.map((text) => Object.freeze({
    kind: "prerequisite" as const,
    text,
  }));
  const invocation = projectedInvocation.state === "ready" && prerequisiteRequirements.length === 0
    ? {
        state: "ready" as const,
        commandId: step.commandId,
        value: projectedInvocation.value,
      }
    : {
        state: "requires-input" as const,
        commandId: step.commandId,
        executable: projectedInvocation.state === "ready"
          ? projectedInvocation.value.executable
          : projectedInvocation.executable,
        route: Object.freeze([...command.route]),
        requirements: Object.freeze([
          ...(projectedInvocation.state === "requires-input" ? projectedInvocation.requirements : []),
          ...prerequisiteRequirements,
        ]),
      };
  const route = Object.freeze([...command.route]);
  return {
    kind: "command",
    commandId: step.commandId,
    guidance: step.guidance,
    prerequisites: Object.freeze([...step.prerequisites]),
    route,
    usage,
    help: { commandId: step.commandId },
    invocation,
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
    ...(skill.intent === undefined ? {} : { intent: skill.intent }),
    ...(skill.invariants.length === 0 ? {} : { invariants: skill.invariants }),
    ...(skill.references.length === 0 ? {} : { references: skill.references }),
    outputBudgetBytes: skill.outputBudgetBytes,
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

function skillOutputOptions(
  skill: ProjectedSkill,
  options: OutputPolicyOptions,
): { readonly maxBytes: number } {
  const maxBytes = options.maxBytes ?? skill.outputBudgetBytes;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < MIN_SKILL_OUTPUT_BUDGET_BYTES) {
    throw new OutputPolicyError(
      "budget",
      `OUTPUT_BUDGET_INVALID: Skill maxBytes must be a safe integer >= ${MIN_SKILL_OUTPUT_BUDGET_BYTES}`,
    );
  }
  return { maxBytes };
}

export function renderSkillText(skill: ProjectedSkill, options: OutputPolicyOptions = {}): string {
  const lines = [skill.summary];
  if (skill.intent !== undefined) lines.push("Intent:", skill.intent);
  if (skill.invariants !== undefined && skill.invariants.length > 0) {
    lines.push("Invariants:", ...skill.invariants.map((invariant) => `- ${invariant}`));
  }
  if (skill.references !== undefined && skill.references.length > 0) {
    lines.push("Domain result references:", ...skill.references.map((reference) => `- ${reference.id}`));
  }
  lines.push("");
  for (const step of skill.steps) {
    if (step.kind === "prose") {
      lines.push(step.text, "");
      continue;
    }
    if (step.kind === "delegate") {
      if (step.guidance !== undefined) lines.push(step.guidance);
      lines.push(`Continue with Skill: ${step.skillId}`, "");
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
  return requireOutput(textOutput(
    `${lines.join("\n").trimEnd()}\n`,
    skillOutputOptions(skill, options),
  ));
}

export function renderSkillJson(skill: ProjectedSkill, options: JsonOutputPolicyOptions = {}): string {
  const policy = {
    ...skillOutputOptions(skill, options),
    ...(options.space === undefined ? { space: 2 } : { space: options.space }),
  };
  return requireOutput(jsonOutput(skill, policy));
}
