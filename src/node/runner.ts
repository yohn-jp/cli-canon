import { Command, CommanderError, Option } from "commander";
import type { CompiledCommand, CompiledField, CompiledProduct } from "../command/compiler.js";
import type { CommandCatalog, CommandId, CommandResultOutput } from "../command/model.js";
import {
  composeCommandProjection,
  projectDiscovery,
  type DiscoveryProjectionProduct,
  type LegacyRouteDescriptor,
} from "../projection/discovery.js";
import { projectHelp, type HelpOutputMode, type HelpRequest, type ParsedHelpMode } from "../projection/help.js";
import type { DomainErrorAdapter } from "../output/model.js";
import type { CliOutcome, CliResult } from "../output/model.js";
import type { ProductDiscovery } from "../projection/discovery.js";
import { cliFailure, jsonOutput, textOutput, toCliResult } from "../output/policy.js";
import { composeCommandSources, projectComposedCommandTree } from "../composition/compiler.js";
import { executeCanonicalArgv, executeComposedArgv } from "../runtime/execution.js";
import type {
  CanonicalArgvBackend,
  CanonicalArgvParse,
  CanonicalExecutionOutcome,
  ExecutableDelegatedCommandSource,
} from "../runtime/model.js";

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
      /** Only `handler-error` carries product errors eligible for domain-error mapping. */
      readonly failureKind: "validation" | "handler-result" | "handler-error" | "unexpected";
      readonly error: unknown;
    };

/** A route resolved to a delegated owner; the delegated executor owns its terminal result. */
export interface NodeCliDelegated {
  readonly status: "delegated";
  readonly sourceId: string;
  readonly commandId: string;
  readonly result: CliResult;
}

export type NodeCliExecution<Catalog extends CommandCatalog = CommandCatalog> =
  NodeCliSuccess<Catalog> | NodeCliHelp | NodeCliFailure | NodeCliDelegated;

/** A delegated command source whose one executor boundary returns its own terminal result. */
export type NodeDelegatedCommandSource = ExecutableDelegatedCommandSource<string, CliResult>;

export interface ExecuteNodeCliOptions {
  readonly helpFormat?: HelpOutputMode | "text";
  readonly legacyRoutes?: readonly LegacyRouteDescriptor[];
  /**
   * Delegated sources composed with the product's canonical source before execution.
   * Each argv resolves to exactly one owner; no failure dispatches to another source.
   */
  readonly delegatedSources?: readonly NodeDelegatedCommandSource[];
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

function silentCommand(name: string): Command {
  const command = new Command(name);
  command.helpOption(false);
  command.addHelpCommand(false);
  command.exitOverride();
  command.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  return command;
}

function parseWith<Value extends object>(
  command: Command,
  argv: readonly string[],
  read: () => Value,
): CanonicalArgvParse<Value, StructuredUsageFailure> {
  try {
    command.parse([...argv], { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) return { status: "failure", failure: classifyCommanderError(error) };
    throw error;
  }
  return { status: "parsed", ...read() };
}

type CommanderOptions = Readonly<Record<string, unknown>>;

/** Collects undecoded Commander tokens for canonical fields; decoding belongs to the semantic runtime. */
function commandInput(
  compiled: CompiledCommand,
  command: Command,
  rootOptions: CommanderOptions,
): Readonly<Record<string, unknown>> {
  const positionals = command.processedArgs;
  const localOptions = command.opts<Record<string, unknown>>();
  const input: Record<string, unknown> = {};
  let positionalIndex = 0;
  for (const field of compiled.fields) {
    if (field.kind === "positional") input[field.key] = positionals[positionalIndex++];
    else if (field.kind === "raw-args") input[field.key] = positionals[positionalIndex] ?? [];
    else {
      const key = commanderKey(field);
      const local = localOptions[key];
      const rootValue = rootOptions[key];
      if (field.kind === "option" && field.repeatable === true) {
        input[field.key] = [
          ...(Array.isArray(rootValue) ? rootValue : rootValue === undefined ? [] : [rootValue]),
          ...(Array.isArray(local) ? local : local === undefined ? [] : [local]),
        ];
      } else if (field.kind === "flag") {
        input[field.key] = local === true || rootValue === true;
      } else {
        input[field.key] = local ?? rootValue;
      }
    }
  }
  return input;
}

/** Commander as an argv grammar backend only: it never selects commands, detects help, or decodes values. */
function commanderBackend<const Catalog extends CommandCatalog>(
  product: CompiledProduct<Catalog>,
): CanonicalArgvBackend<StructuredUsageFailure, CommanderOptions> {
  const compiledById = new Map<string, CompiledCommand>(product.commands.map((command) => [command.id, command]));
  return {
    parseLeading(scope, argv) {
      const command = silentCommand(product.name);
      if (scope.kind === "root") addAnywhereOptions(command, product);
      let operands: readonly string[] = [];
      command
        .passThroughOptions()
        .argument("[operands...]")
        .action((values: string[]) => {
          operands = values;
        });
      return parseWith(command, argv, () => ({ operands, state: command.opts<Record<string, unknown>>() }));
    },
    parseCommand(node, argv, rootOptions) {
      const compiled = compiledById.get(node.id);
      if (compiled === undefined) throw new Error(`${node.id}: resolved command has no compiled grammar`);
      const command = silentCommand(product.name);
      addInputSyntax(command, compiled);
      command.action(() => {});
      return parseWith(command, argv, () => ({ input: commandInput(compiled, command, rootOptions) }));
    },
  };
}

/** Adapts a semantic runtime outcome to the Node execution contract without re-resolving or re-decoding. */
function nodeCliExecution<const Catalog extends CommandCatalog>(
  outcome: CanonicalExecutionOutcome<Catalog>,
): NodeCliExecution<Catalog> {
  if (outcome.status === "success") {
    return { status: "success", commandId: outcome.commandId, result: outcome.result } as NodeCliSuccess<Catalog>;
  }
  if (outcome.failureKind === "usage") {
    const { code, commandId, option, value } = outcome.usageFailure;
    return {
      status: "failure",
      failureKind: "usage",
      usageFailure: {
        code,
        ...(commandId === undefined ? {} : { commandId }),
        ...(option === undefined ? {} : { option }),
        ...(value === undefined ? {} : { value }),
      },
    };
  }
  return { status: "failure", failureKind: outcome.failureKind, error: outcome.error };
}

export async function executeNodeCli<const Catalog extends CommandCatalog>(
  product: CompiledProduct<Catalog>,
  argv: readonly string[],
  options: ExecuteNodeCliOptions = {},
): Promise<NodeCliExecution<Catalog>> {
  if (options.delegatedSources !== undefined) return executeComposedNodeCli(product, argv, options);
  const projection = composeCommandProjection(product, options.legacyRoutes ?? []);
  const outcome = await executeCanonicalArgv(product, {
    argv,
    backend: commanderBackend(product),
    help: projection,
    ...(options.helpFormat === undefined ? {} : { helpFormat: options.helpFormat }),
  });
  if (outcome.status === "help") return nodeCliHelp(projection, outcome.help);
  if (outcome.status === "failure" && outcome.failureKind === "grammar") {
    return { status: "failure", failureKind: "usage", usageFailure: outcome.grammarFailure };
  }
  return nodeCliExecution(outcome);
}

/**
 * Composes the product's canonical source with delegated sources, resolves the owner
 * from the composed tree, and invokes exactly that owner's executor.
 */
async function executeComposedNodeCli<const Catalog extends CommandCatalog>(
  product: CompiledProduct<Catalog>,
  argv: readonly string[],
  options: ExecuteNodeCliOptions,
): Promise<NodeCliExecution<Catalog>> {
  const sources = [{ kind: "canonical", id: product.name, product }, ...(options.delegatedSources ?? [])] as const;
  const tree = composeCommandSources(sources);
  const projection = composeCommandProjection(
    projectComposedCommandTree(tree, {
      name: product.name,
      ...(product.packageMetadata === undefined ? {} : { packageMetadata: product.packageMetadata }),
    }),
    options.legacyRoutes ?? [],
  );
  const outcome = await executeComposedArgv(
    { tree, sources },
    {
      argv,
      backend: commanderBackend(product),
      help: projection,
      ...(options.helpFormat === undefined ? {} : { helpFormat: options.helpFormat }),
    },
  );
  if (outcome.status === "help") return nodeCliHelp(projection, outcome.help);
  if (outcome.status === "delegated") {
    return { status: "delegated", sourceId: outcome.sourceId, commandId: outcome.commandId, result: outcome.result };
  }
  if (outcome.status === "failure" && outcome.failureKind === "grammar") {
    return { status: "failure", failureKind: "usage", usageFailure: outcome.grammarFailure };
  }
  if (outcome.status === "failure" && outcome.failureKind === "delegated-error") {
    return { status: "failure", failureKind: "handler-error", error: outcome.error };
  }
  return nodeCliExecution(outcome as CanonicalExecutionOutcome<Catalog>);
}

export function projectNodeCliExecution<DomainError = never, Catalog extends CommandCatalog = CommandCatalog>(
  execution: NodeCliExecution<Catalog>,
  options: ProjectNodeCliExecutionOptions<DomainError, Catalog> = {},
): CliResult {
  const maxOutputBytes = options.maxOutputBytes;
  if (execution.status === "delegated") return execution.result;
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
  if (execution.failureKind === "unexpected") {
    return toCliResult(
      failureResult("unexpected", `UNEXPECTED: ${errorMessage(execution.error)}\n`, 1, maxOutputBytes),
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
