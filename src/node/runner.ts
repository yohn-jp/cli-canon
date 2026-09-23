import { Command, CommanderError, Option } from "commander";
import type { CompiledCommand, CompiledField, CompiledProduct } from "../command/compiler.js";
import type { CommandCatalog, CommandId, CommandResultOutput, FieldDefinition } from "../command/model.js";
import {
  composeCommandProjection,
  projectDiscovery,
  type DiscoveryProjectionProduct,
  type LegacyRouteDescriptor,
} from "../projection/discovery.js";
import {
  parseHelpMode,
  projectHelp,
  type HelpOutputMode,
  type HelpRequest,
  type ParsedHelpMode,
} from "../projection/help.js";
import type { DomainErrorAdapter } from "../output/model.js";
import type { CliOutcome, CliResult } from "../output/model.js";
import type { ProductDiscovery } from "../projection/discovery.js";
import { cliFailure, jsonOutput, textOutput, toCliResult } from "../output/policy.js";

export type { CliFailureKind, CliResult } from "../output/model.js";

export type StructuredUsageErrorCode =
  | "extra-positional-argument"
  | "unknown-option"
  | "missing-option-value"
  | "missing-required-option"
  | "missing-positional-argument"
  | "unknown-command"
  | "invalid-help-mode"
  | "no-command"
  | "invalid-arguments";

/** Parser-owned usage classification; consumers do not need to inspect diagnostics. */
export interface StructuredUsageFailure {
  readonly code: StructuredUsageErrorCode;
  readonly parserCode?: string;
  readonly commandId?: string;
  readonly option?: string;
  readonly value?: string;
}

export interface NodeCliSuccess<Catalog extends CommandCatalog = CommandCatalog> {
  readonly status: "success";
  readonly commandId: CommandId<Catalog>;
  readonly result: CommandResultOutput<Catalog[CommandId<Catalog>]>;
}

export interface NodeCliHelp {
  readonly status: "help";
  readonly mode: HelpOutputMode;
  /** Canon-resolved help target; consumers never need to parse help argv. */
  readonly request: HelpRequest;
  /** Canon-owned metadata scoped to the resolved help target for presentation adapters. */
  readonly discovery: ProductDiscovery;
  readonly projection: string | ProductDiscovery;
}

export type NodeCliFailure =
  | {
      readonly status: "failure";
      readonly failureKind: "usage";
      readonly usageFailure: StructuredUsageFailure;
    }
  | {
      readonly status: "failure";
      readonly failureKind: "validation" | "handler-result" | "handler-error";
      readonly error: unknown;
    };

export type NodeCliExecution<Catalog extends CommandCatalog = CommandCatalog> =
  NodeCliSuccess<Catalog> | NodeCliHelp | NodeCliFailure;

export interface ExecuteNodeCliOptions {
  readonly helpFormat?: HelpOutputMode | "text";
  readonly legacyRoutes?: readonly LegacyRouteDescriptor[];
}

/** A terminal projection is returned as a Canon output outcome, never written by the handler. */
export interface NodeCliTerminalAdapter<Catalog extends CommandCatalog = CommandCatalog> {
  readonly success?: (execution: NodeCliSuccess<Catalog>) => CliOutcome;
  /** Render consumer-specific terminal help from Canon-resolved help metadata. */
  readonly help?: (execution: NodeCliHelp) => CliOutcome;
  readonly usageFailure?: (failure: StructuredUsageFailure) => CliOutcome;
}

export interface ProjectNodeCliExecutionOptions<DomainError = never, Catalog extends CommandCatalog = CommandCatalog> {
  readonly maxOutputBytes?: number;
  readonly domainErrorAdapter?: DomainErrorAdapter<DomainError>;
  readonly terminalAdapter?: NodeCliTerminalAdapter<Catalog>;
}

export interface RunNodeCliOptions<DomainError = never, Catalog extends CommandCatalog = CommandCatalog>
  extends ExecuteNodeCliOptions, ProjectNodeCliExecutionOptions<DomainError, Catalog> {}

function outputPolicyOptions(maxOutputBytes: number | undefined): { readonly maxBytes?: number } {
  return maxOutputBytes === undefined ? {} : { maxBytes: maxOutputBytes };
}

function failureResult(
  failureKind: Parameters<typeof cliFailure>[0],
  output: string,
  exitCode: number,
  maxOutputBytes: number | undefined,
  stream: "stdout" | "stderr" = "stderr",
): CliOutcome {
  const bounded = textOutput(output, outputPolicyOptions(maxOutputBytes));
  return bounded.status === "success" ? cliFailure(failureKind, bounded.output, exitCode, stream) : bounded;
}

function boundedOutcome(outcome: CliOutcome, maxOutputBytes: number | undefined): CliOutcome {
  if (maxOutputBytes === undefined) return outcome;
  const bounded = textOutput(outcome.output, { maxBytes: maxOutputBytes });
  if (bounded.status === "failure") return bounded;
  return outcome.status === "success"
    ? bounded
    : cliFailure(outcome.failureKind, bounded.output, outcome.exitCode, outcome.stream);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function camelcase(value: string): string {
  return value.replace(/^--?/u, "").replace(/-([a-z0-9])/gu, (_match, letter: string) => letter.toUpperCase());
}

function commanderKey(field: CompiledField): string {
  const long = [field.flag, ...(field.aliases ?? [])].find((candidate) => candidate?.startsWith("--"));
  return camelcase(long ?? field.flag ?? field.key);
}

function flagsFor(field: CompiledField): string {
  const all = [...(field.aliases ?? []), field.flag].filter((value): value is string => value !== undefined);
  const prefix = all.join(", ");
  if (field.kind === "flag") return prefix;
  const metavar = field.metavar ?? field.key;
  return field.valueArity === "optional" ? `${prefix} [${metavar}]` : `${prefix} <${metavar}>`;
}

function makeOption(field: CompiledField, enforceRequired = true): Option {
  const result = new Option(flagsFor(field));
  if (field.kind === "option" && field.required === true && enforceRequired) result.makeOptionMandatory(true);
  if (field.kind === "option" && field.repeatable === true) {
    result.argParser((value: string, previous: string[] | undefined) => [...(previous ?? []), value]);
  }
  return result;
}

function fieldDefinition(command: CompiledCommand, key: string): FieldDefinition {
  const field = command.definition.input[key];
  if (field === undefined) throw new Error(`compiled field ${command.id}.${key} has no declaration`);
  return field;
}

async function decodeInput(
  command: CompiledCommand,
  raw: Readonly<Record<string, unknown>>,
): Promise<Readonly<Record<string, unknown>>> {
  const decoded: Record<string, unknown> = {};
  for (const field of command.fields) {
    const definition = fieldDefinition(command, field.key);
    const value = raw[field.key];
    if (definition.kind === "flag") {
      decoded[field.key] = value === true;
      continue;
    }
    if (definition.kind === "raw-args") {
      decoded[field.key] = Array.isArray(value) ? value : [];
      continue;
    }
    if (definition.kind === "option" && definition.repeatable) {
      const values = Array.isArray(value) ? value : [];
      const parsed: unknown[] = [];
      for (const item of values) {
        if (item === true && definition.valueArity === "optional") parsed.push(undefined);
        else parsed.push(await definition.schema.parseAsync(item));
      }
      decoded[field.key] = parsed;
      continue;
    }
    if (definition.kind === "positional" && value === undefined && !definition.required) {
      decoded[field.key] = undefined;
      continue;
    }
    if (definition.kind === "option" && value === true && definition.valueArity === "optional") {
      decoded[field.key] = undefined;
      continue;
    }
    if (value === undefined && definition.kind === "option" && !definition.required) {
      decoded[field.key] = undefined;
      continue;
    }
    decoded[field.key] = await definition.schema.parseAsync(value);
  }
  return decoded;
}

function addInputSyntax(command: Command, compiled: CompiledCommand): void {
  for (const field of compiled.fields) {
    if (field.kind === "positional") {
      const name = field.metavar ?? field.key;
      command.argument(field.required === false ? `[${name}]` : `<${name}>`);
    } else if (field.kind === "raw-args") command.argument("[args...]");
    else command.addOption(makeOption(field, field.placement !== "anywhere"));
  }
  command.allowExcessArguments(false);
}

interface RouteNode {
  command: Command;
  readonly children: Map<string, RouteNode>;
}

function childNode(parent: RouteNode, segment: string): RouteNode {
  const existing = parent.children.get(segment);
  if (existing !== undefined) return existing;
  const command = parent.command.command(segment);
  command.helpOption(false);
  command.addHelpCommand(false);
  const node = { command, children: new Map<string, RouteNode>() };
  parent.children.set(segment, node);
  return node;
}

function addAnywhereOptions<const Catalog extends CommandCatalog>(
  program: Command,
  product: CompiledProduct<Catalog>,
): void {
  const seen = new Set<string>();
  for (const command of product.commands) {
    for (const field of command.fields) {
      if (
        (field.kind === "option" || field.kind === "flag") &&
        field.placement === "anywhere" &&
        field.flag !== undefined
      ) {
        if (seen.has(field.flag)) continue;
        seen.add(field.flag);
        program.addOption(makeOption(field, false));
      }
    }
  }
}

function classifyCommanderError(error: CommanderError, commandId?: string): StructuredUsageFailure {
  const code =
    error.code === "commander.excessArguments"
      ? "extra-positional-argument"
      : error.code === "commander.unknownOption"
        ? "unknown-option"
        : error.code === "commander.optionMissingArgument"
          ? "missing-option-value"
          : error.code === "commander.missingMandatoryOptionValue"
            ? "missing-required-option"
            : error.code === "commander.missingArgument"
              ? "missing-positional-argument"
              : error.code === "commander.unknownCommand"
                ? "unknown-command"
                : "invalid-arguments";
  return {
    code,
    parserCode: error.code,
    ...(commandId === undefined ? {} : { commandId }),
  };
}

function projectHelpDiscovery(product: DiscoveryProjectionProduct, request: HelpRequest): ProductDiscovery {
  let route: readonly string[] | undefined;
  if (request.kind === "route") route = request.route;
  else if (request.kind === "command") {
    route = product.commands.find((command) => command.id === request.commandId)?.route;
  }
  return projectDiscovery(product, route === undefined ? {} : { route });
}

function nodeCliHelp(product: DiscoveryProjectionProduct, parsed: ParsedHelpMode): NodeCliHelp {
  return {
    status: "help",
    mode: parsed.mode,
    request: parsed.request,
    discovery: projectHelpDiscovery(product, parsed.request),
    projection: projectHelp(product, parsed),
  };
}

function usageFailure(failure: StructuredUsageFailure, maxOutputBytes: number | undefined): CliOutcome {
  const message =
    failure.code === "extra-positional-argument"
      ? "error: too many arguments\n"
      : failure.code === "unknown-option"
        ? "error: unknown option\n"
        : failure.code === "missing-option-value"
          ? "error: option value missing\n"
          : failure.code === "missing-required-option"
            ? `error: required option '${failure.option ?? "unknown"}' not specified\n`
            : failure.code === "missing-positional-argument"
              ? "error: required argument missing\n"
              : failure.code === "unknown-command"
                ? "error: unknown command\n"
                : failure.code === "invalid-help-mode"
                  ? `Unknown help mode: ${failure.value ?? ""}\n`
                  : failure.code === "no-command"
                    ? "No command selected.\n"
                    : "error: invalid command arguments\n";
  return failureResult("usage", message, 2, maxOutputBytes);
}

export async function executeNodeCli<const Catalog extends CommandCatalog>(
  product: CompiledProduct<Catalog>,
  argv: readonly string[],
  options: ExecuteNodeCliOptions = {},
): Promise<NodeCliExecution<Catalog>> {
  const projection = composeCommandProjection(product, options.legacyRoutes ?? []);
  const parsedHelp = parseHelpMode(projection, argv, options.helpFormat);
  if (parsedHelp !== undefined) {
    if (parsedHelp.invalidMode !== undefined) {
      return {
        status: "failure",
        failureKind: "usage",
        usageFailure: { code: "invalid-help-mode", value: parsedHelp.invalidMode },
      };
    }
    return nodeCliHelp(projection, parsedHelp);
  }

  let invocation: Promise<NodeCliExecution<Catalog>> | undefined;
  const program = new Command(product.name);
  program.helpOption(false);
  program.addHelpCommand(false);
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  program.enablePositionalOptions();
  addAnywhereOptions(program, product);
  const root: RouteNode = { command: program, children: new Map() };

  for (const compiled of product.commands) {
    let node = root;
    for (const segment of compiled.route) node = childNode(node, segment);
    node.command.description(compiled.summary);
    addInputSyntax(node.command, compiled);
    node.command.action(async (...actionArgs: unknown[]) => {
      invocation = (async () => {
        try {
          const command = actionArgs.at(-1) as Command;
          const positionals = command.processedArgs;
          const localOptions = command.opts<Record<string, unknown>>();
          const rootOptions = program.opts<Record<string, unknown>>();
          const raw: Record<string, unknown> = {};
          let positionalIndex = 0;
          for (const field of compiled.fields) {
            if (field.kind === "positional") raw[field.key] = positionals[positionalIndex++];
            else if (field.kind === "raw-args") raw[field.key] = positionals[positionalIndex] ?? [];
            else {
              const key = commanderKey(field);
              const local = localOptions[key];
              const rootValue = rootOptions[key];
              if (field.kind === "option" && field.repeatable === true) {
                raw[field.key] = [
                  ...(Array.isArray(rootValue) ? rootValue : rootValue === undefined ? [] : [rootValue]),
                  ...(Array.isArray(local) ? local : local === undefined ? [] : [local]),
                ];
              } else if (field.kind === "flag") {
                raw[field.key] = local === true || rootValue === true;
              } else {
                raw[field.key] = local ?? rootValue;
              }
            }
          }

          const missingRequiredOption = compiled.fields.find((field) => {
            if (field.kind !== "option" || field.required !== true) return false;
            const value = raw[field.key];
            return field.repeatable === true ? !Array.isArray(value) || value.length === 0 : value === undefined;
          });
          if (missingRequiredOption !== undefined) {
            return {
              status: "failure",
              failureKind: "usage",
              usageFailure: {
                code: "missing-required-option",
                commandId: compiled.id,
                ...(missingRequiredOption.flag === undefined ? {} : { option: missingRequiredOption.flag }),
              },
            };
          }

          let decoded: Readonly<Record<string, unknown>>;
          try {
            decoded = await decodeInput(compiled, raw);
          } catch (error) {
            return { status: "failure", failureKind: "validation", error };
          }

          const handler = product.handlers[compiled.id as keyof Catalog] as (
            input: Readonly<Record<string, unknown>>,
          ) => unknown;
          let rawResult: unknown;
          try {
            rawResult = await handler(decoded);
          } catch (error) {
            return { status: "failure", failureKind: "handler-error", error };
          }
          let result;
          try {
            result = await compiled.definition.result.parseAsync(rawResult);
          } catch (error) {
            return { status: "failure", failureKind: "handler-result", error };
          }
          return { status: "success", commandId: compiled.id, result };
        } catch (error) {
          return { status: "failure", failureKind: "handler-error", error };
        }
      })();
      await invocation;
    });
  }

  try {
    await program.parseAsync(["node", product.name, ...argv]);
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code === "commander.helpDisplayed") {
        const rootHelp = parseHelpMode(projection, ["--help"], options.helpFormat);
        if (rootHelp !== undefined) return nodeCliHelp(projection, rootHelp);
      }
      return { status: "failure", failureKind: "usage", usageFailure: classifyCommanderError(error) };
    }
    return { status: "failure", failureKind: "handler-error", error };
  }

  return invocation === undefined
    ? {
        status: "failure",
        failureKind: "usage",
        usageFailure: { code: "no-command", parserCode: "canon.noCommandSelected" },
      }
    : await invocation;
}

export function projectNodeCliExecution<DomainError = never, Catalog extends CommandCatalog = CommandCatalog>(
  execution: NodeCliExecution<Catalog>,
  options: ProjectNodeCliExecutionOptions<DomainError, Catalog> = {},
): CliResult {
  const maxOutputBytes = options.maxOutputBytes;
  if (execution.status === "success") {
    const outcome =
      options.terminalAdapter?.success?.(execution) ??
      jsonOutput(execution.result, outputPolicyOptions(maxOutputBytes));
    return toCliResult(boundedOutcome(outcome, maxOutputBytes));
  }
  if (execution.status === "help") {
    const outcome =
      options.terminalAdapter?.help?.(execution) ??
      (typeof execution.projection === "string"
        ? textOutput(execution.projection, outputPolicyOptions(maxOutputBytes))
        : jsonOutput(execution.projection, outputPolicyOptions(maxOutputBytes)));
    return toCliResult(boundedOutcome(outcome, maxOutputBytes));
  }

  if (execution.failureKind === "usage") {
    const outcome =
      options.terminalAdapter?.usageFailure?.(execution.usageFailure) ??
      usageFailure(execution.usageFailure, maxOutputBytes);
    return toCliResult(boundedOutcome(outcome, maxOutputBytes));
  }
  if (execution.failureKind === "validation") {
    return toCliResult(
      failureResult("validation", `INVALID_INPUT: ${errorMessage(execution.error)}\n`, 2, maxOutputBytes),
    );
  }
  if (execution.failureKind === "handler-result") {
    return toCliResult(
      failureResult("handler-result", `INVALID_HANDLER_RESULT: ${errorMessage(execution.error)}\n`, 1, maxOutputBytes),
    );
  }

  const adapter = options.domainErrorAdapter;
  if (adapter?.is(execution.error) === true) {
    const mapped = adapter.map(execution.error);
    return toCliResult(failureResult("domain", mapped.output, mapped.exitCode, maxOutputBytes, mapped.stream));
  }
  return toCliResult(failureResult("unexpected", `UNEXPECTED: ${errorMessage(execution.error)}\n`, 1, maxOutputBytes));
}

export async function runNodeCli<const Catalog extends CommandCatalog, DomainError = never>(
  product: CompiledProduct<Catalog>,
  argv: readonly string[],
  options: RunNodeCliOptions<DomainError, Catalog> = {},
): Promise<CliResult> {
  const execution = await executeNodeCli(product, argv, options);
  return projectNodeCliExecution(execution, options);
}
