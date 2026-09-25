import { Command, CommanderError, Option } from "commander";
import type { CompiledCommand, CompiledField, CompiledProduct } from "../command/compiler.js";
import type { CommandCatalog, CommandId, CommandResultOutput } from "../command/model.js";
import {
  composeCommandProjection,
  projectDiscovery,
  type DiscoveryProjectionProduct,
  type LegacyRouteDescriptor,
} from "../projection/discovery.js";
import {
  projectHelp,
  projectHelpDocument,
  resolveHelpTarget,
  type HelpOutputMode,
  type HelpProjectionProduct,
  type HelpRequest,
  type HelpTarget,
  type ParsedHelpMode,
} from "../projection/help.js";
import { renderUsageFailure } from "../presentation/index.js";
import type { DomainErrorAdapter, PresentationMode } from "../output/model.js";
import type { CliOutcome, CliResult } from "../output/model.js";
import type { ProductPackageIdentity } from "../product/identity.js";
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

export type { CliFailureKind, CliResult, PresentationMode } from "../output/model.js";

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

/**
 * A validated command result correlated with its command identity: narrowing
 * `commandId` narrows `result` to that command's result schema output.
 * `presentation` is the Canon-resolved presentation mode of the invocation.
 */
export type NodeCliSuccess<Catalog extends CommandCatalog = CommandCatalog> = {
  readonly [Id in CommandId<Catalog>]: {
    readonly status: "success";
    readonly commandId: Id;
    readonly result: CommandResultOutput<Catalog[Id]>;
    readonly presentation: PresentationMode;
  };
}[CommandId<Catalog>];

export interface NodeCliHelp {
  readonly status: "help";
  readonly presentation: PresentationMode;
  readonly mode: HelpOutputMode;
  /** Canon-resolved help target; consumers never need to parse help argv. */
  readonly request: HelpRequest;
  /** Canon-owned metadata scoped to the resolved help target for presentation adapters. */
  readonly discovery: ProductDiscovery;
  readonly projection: string | ProductDiscovery;
}

/** A Canon version request projected from `CompiledProduct.packageMetadata`, the single version authority. */
export interface NodeCliVersion {
  readonly status: "version";
  readonly presentation: PresentationMode;
  readonly packageMetadata: ProductPackageIdentity;
}

export type NodeCliFailure =
  | {
      readonly status: "failure";
      readonly presentation: PresentationMode;
      readonly failureKind: "usage";
      readonly usageFailure: StructuredUsageFailure;
      /** Usage tokens projected from the canonical help document for this failure target. */
      readonly usage: readonly string[];
    }
  | {
      readonly status: "failure";
      readonly presentation: PresentationMode;
      /** Only `handler-error` carries product errors eligible for domain-error mapping. */
      readonly failureKind: "validation" | "handler-result" | "handler-error" | "unexpected";
      readonly error: unknown;
    };

/** A route resolved to a delegated owner; the delegated executor owns its terminal result. */
export interface NodeCliDelegated {
  readonly status: "delegated";
  readonly presentation: PresentationMode;
  readonly sourceId: string;
  readonly commandId: string;
  readonly result: CliResult;
}

export type NodeCliExecution<Catalog extends CommandCatalog = CommandCatalog> =
  NodeCliSuccess<Catalog> | NodeCliHelp | NodeCliVersion | NodeCliFailure | NodeCliDelegated;

/** A delegated command source whose one executor boundary returns its own terminal result. */
export type NodeDelegatedCommandSource = ExecutableDelegatedCommandSource<string, CliResult>;

export interface ExecuteNodeCliOptions {
  readonly helpFormat?: HelpOutputMode | "text";
  /**
   * @deprecated Declare these routes in a delegated command source and pass it
   * through `delegatedSources`; help and discovery then use the resolved tree.
   */
  readonly legacyRoutes?: readonly LegacyRouteDescriptor[];
  /**
   * Delegated sources composed with the product's canonical source before execution.
   * Each argv resolves to exactly one owner; no failure dispatches to another source.
   */
  readonly delegatedSources?: readonly NodeDelegatedCommandSource[];
}

/** Product-owned presentation of the validated command result. */
export interface NodeCliResultPresenter<Catalog extends CommandCatalog = CommandCatalog> {
  readonly success?: (execution: NodeCliSuccess<Catalog>) => CliOutcome;
}

/** Explicit opt-out for products that own a special terminal surface; never applied in machine presentation mode. */
export interface NodeCliSpecialTerminalSurface<Catalog extends CommandCatalog = CommandCatalog> {
  /** Replace standard help only when the product explicitly opts into a special surface. */
  readonly help?: (execution: NodeCliHelp) => CliOutcome;
  /** Replace standard usage presentation only for an explicit special surface. */
  readonly usageFailure?: (failure: StructuredUsageFailure) => CliOutcome;
}

/**
 * @deprecated Use NodeCliResultPresenter for product result presentation and
 * NodeCliSpecialTerminalSurface only for an explicit special-surface opt-out.
 * Standard help and usage callbacks on this compatibility type are ignored.
 */
export interface NodeCliTerminalAdapter<Catalog extends CommandCatalog = CommandCatalog> {
  /** @deprecated Use NodeCliResultPresenter.success. */
  readonly success?: (execution: NodeCliSuccess<Catalog>) => CliOutcome;
  /** @deprecated Standard help is Canon-owned; use specialTerminalSurface.help only for a special surface. */
  readonly help?: (execution: NodeCliHelp) => CliOutcome;
  /** @deprecated Standard usage presentation is Canon-owned; use specialTerminalSurface.usageFailure only for a special surface. */
  readonly usageFailure?: (failure: StructuredUsageFailure) => CliOutcome;
}

export interface ProjectNodeCliExecutionOptions<DomainError = never, Catalog extends CommandCatalog = CommandCatalog> {
  readonly maxOutputBytes?: number;
  readonly domainErrorAdapter?: DomainErrorAdapter<DomainError>;
  readonly resultPresenter?: NodeCliResultPresenter<Catalog>;
  readonly specialTerminalSurface?: NodeCliSpecialTerminalSurface<Catalog>;
  /** @deprecated Use resultPresenter and specialTerminalSurface. */
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

function nodeCliHelp(
  product: DiscoveryProjectionProduct,
  parsed: ParsedHelpMode,
  presentation: PresentationMode,
): NodeCliHelp {
  return {
    status: "help",
    presentation,
    mode: parsed.mode,
    request: parsed.request,
    discovery: projectHelpDiscovery(product, parsed.request),
    projection: projectHelp(product, parsed),
  };
}

function usageFailure(
  failure: StructuredUsageFailure,
  usage: readonly string[],
  maxOutputBytes: number | undefined,
): CliOutcome {
  return failureResult("usage", renderUsageFailure(failure, usage), 2, maxOutputBytes);
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
  commandId?: string,
): CanonicalArgvParse<Value, StructuredUsageFailure> {
  try {
    command.parse([...argv], { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError)
      return { status: "failure", failure: classifyCommanderError(error, commandId) };
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
      return parseWith(command, argv, () => ({ input: commandInput(compiled, command, rootOptions) }), compiled.id);
    },
  };
}

/** Projects failure usage from the canonical help target already selected by runtime classification. */
function usageForFailure(
  product: HelpProjectionProduct,
  failure: StructuredUsageFailure & { readonly route?: readonly string[] },
): readonly string[] {
  let target: HelpTarget | undefined;
  if (failure.commandId !== undefined) {
    const command = product.commands.find((candidate) => candidate.id === failure.commandId);
    if (command !== undefined) target = { kind: "command", id: command.id, route: command.route };
  }
  if (target === undefined && failure.route !== undefined) {
    for (let length = failure.route.length; length >= 0; length -= 1) {
      target = resolveHelpTarget(product, failure.route.slice(0, length));
      if (target !== undefined) break;
    }
  }
  const document =
    projectHelpDocument(product, target ?? { kind: "root" }) ?? projectHelpDocument(product, { kind: "root" });
  if (document === undefined) throw new Error("Canonical root help document is unavailable");
  return document.usage;
}

/** Adapts a semantic runtime outcome to the Node execution contract without re-resolving or re-decoding. */
function nodeCliExecution<const Catalog extends CommandCatalog>(
  outcome: CanonicalExecutionOutcome<Catalog> & { readonly presentation: PresentationMode },
  product: HelpProjectionProduct,
): NodeCliExecution<Catalog> {
  const { presentation } = outcome;
  if (outcome.status === "success") {
    const { route: _route, ...success } = outcome;
    return success;
  }
  if (outcome.failureKind === "usage") {
    const { code, commandId, option, value } = outcome.usageFailure;
    const usageFailure = {
      code,
      ...(commandId === undefined ? {} : { commandId }),
      ...(option === undefined ? {} : { option }),
      ...(value === undefined ? {} : { value }),
    };
    return {
      status: "failure",
      presentation,
      failureKind: "usage",
      usageFailure,
      usage: usageForFailure(product, { ...outcome.usageFailure, ...usageFailure }),
    };
  }
  return { status: "failure", presentation, failureKind: outcome.failureKind, error: outcome.error };
}

/** Adapts the runtime's shell outcomes; the presentation mode is carried, never re-derived. */
function nodeCliShellExecution(
  outcome:
    | { readonly status: "help"; readonly help: ParsedHelpMode; readonly presentation: PresentationMode }
    | {
        readonly status: "version";
        readonly packageMetadata: ProductPackageIdentity;
        readonly presentation: PresentationMode;
      }
    | {
        readonly status: "failure";
        readonly failureKind: "grammar";
        readonly grammarFailure: StructuredUsageFailure;
        readonly presentation: PresentationMode;
      },
  product: DiscoveryProjectionProduct,
): NodeCliHelp | NodeCliVersion | NodeCliFailure {
  const { presentation } = outcome;
  if (outcome.status === "help") return nodeCliHelp(product, outcome.help, presentation);
  if (outcome.status === "version") {
    return { status: "version", presentation, packageMetadata: outcome.packageMetadata };
  }
  return {
    status: "failure",
    presentation,
    failureKind: "usage",
    usageFailure: outcome.grammarFailure,
    usage: usageForFailure(product, outcome.grammarFailure),
  };
}

export async function executeNodeCli<const Catalog extends CommandCatalog>(
  product: CompiledProduct<Catalog>,
  argv: readonly string[],
  options: ExecuteNodeCliOptions = {},
): Promise<NodeCliExecution<Catalog>> {
  if (options.delegatedSources !== undefined) return executeComposedNodeCli(product, argv, options);
  const projection =
    options.legacyRoutes === undefined
      ? projectComposedCommandTree(composeCommandSources([{ kind: "canonical", id: product.name, product }]), {
          name: product.name,
          ...(product.description === undefined ? {} : { description: product.description }),
          ...(product.packageMetadata === undefined ? {} : { packageMetadata: product.packageMetadata }),
        })
      : composeCommandProjection(product, options.legacyRoutes);
  const outcome = await executeCanonicalArgv(product, {
    argv,
    backend: commanderBackend(product),
    help: projection,
    ...(options.helpFormat === undefined ? {} : { helpFormat: options.helpFormat }),
  });
  if (outcome.status === "help" || outcome.status === "version") return nodeCliShellExecution(outcome, projection);
  if (outcome.status === "failure" && outcome.failureKind === "grammar") {
    return nodeCliShellExecution(outcome, projection);
  }
  return nodeCliExecution(outcome, projection);
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
  const resolvedProjection = projectComposedCommandTree(tree, {
    name: product.name,
    ...(product.description === undefined ? {} : { description: product.description }),
    ...(product.packageMetadata === undefined ? {} : { packageMetadata: product.packageMetadata }),
  });
  const projection =
    options.legacyRoutes === undefined
      ? resolvedProjection
      : composeCommandProjection(resolvedProjection, options.legacyRoutes);
  const outcome = await executeComposedArgv(
    { tree, sources },
    {
      argv,
      backend: commanderBackend(product),
      help: projection,
      ...(options.helpFormat === undefined ? {} : { helpFormat: options.helpFormat }),
    },
  );
  const { presentation } = outcome;
  if (outcome.status === "help" || outcome.status === "version") return nodeCliShellExecution(outcome, projection);
  if (outcome.status === "delegated") {
    return {
      status: "delegated",
      presentation,
      sourceId: outcome.sourceId,
      commandId: outcome.commandId,
      result: outcome.result,
    };
  }
  if (outcome.status === "failure" && outcome.failureKind === "grammar") {
    return nodeCliShellExecution(outcome, projection);
  }
  if (outcome.status === "failure" && outcome.failureKind === "delegated-error") {
    return { status: "failure", presentation, failureKind: "handler-error", error: outcome.error };
  }
  return nodeCliExecution(
    outcome as CanonicalExecutionOutcome<Catalog> & { readonly presentation: PresentationMode },
    projection,
  );
}

export function projectNodeCliExecution<DomainError = never, Catalog extends CommandCatalog = CommandCatalog>(
  execution: NodeCliExecution<Catalog>,
  options: ProjectNodeCliExecutionOptions<DomainError, Catalog> = {},
): CliResult {
  const maxOutputBytes = options.maxOutputBytes;
  if (execution.status === "delegated") return execution.result;
  if (execution.status === "success") {
    const outcome =
      options.resultPresenter?.success?.(execution) ??
      options.terminalAdapter?.success?.(execution) ??
      jsonOutput(execution.result, outputPolicyOptions(maxOutputBytes));
    return toCliResult(boundedOutcome(outcome, maxOutputBytes));
  }
  const special = execution.presentation === "human" ? options.specialTerminalSurface : undefined;
  if (execution.status === "version") {
    const { name, version } = execution.packageMetadata;
    const outcome =
      execution.presentation === "machine"
        ? jsonOutput({ name, version }, outputPolicyOptions(maxOutputBytes))
        : textOutput(`${version}\n`, outputPolicyOptions(maxOutputBytes));
    return toCliResult(outcome);
  }
  if (execution.status === "help") {
    const outcome =
      special?.help?.(execution) ??
      (typeof execution.projection === "string"
        ? textOutput(execution.projection, outputPolicyOptions(maxOutputBytes))
        : jsonOutput(execution.projection, outputPolicyOptions(maxOutputBytes)));
    return toCliResult(boundedOutcome(outcome, maxOutputBytes));
  }

  if (execution.failureKind === "usage") {
    const outcome =
      special?.usageFailure?.(execution.usageFailure) ??
      usageFailure(execution.usageFailure, execution.usage, maxOutputBytes);
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
    const mapped = adapter.map(execution.error, execution.presentation);
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
