import { Command, CommanderError, Option } from "commander";
import type { CompiledCommand, CompiledField, CompiledProduct } from "../command/compiler.js";
import type { CommandCatalog, FieldDefinition } from "../command/model.js";
import { projectDiscovery } from "../projection/discovery.js";
import { renderHelp, type HelpRequest } from "../projection/help.js";

export type CliFailureKind = "usage" | "validation" | "handler-result" | "unexpected";

export interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly failureKind?: CliFailureKind;
}

export interface RunNodeCliOptions {
  readonly helpFormat?: "text" | "full" | "json";
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

function makeOption(field: CompiledField): Option {
  const result = new Option(flagsFor(field));
  if (field.kind === "option" && field.required === true) result.makeOptionMandatory(true);
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
    }
    else if (field.kind === "raw-args") command.argument("[args...]");
    else command.addOption(makeOption(field));
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
        program.addOption(makeOption(field));
      }
    }
  }
}

function stringifyResult(value: unknown): string {
  if (value === undefined) return "";
  const json = JSON.stringify(value);
  return json === undefined ? "" : `${json}\n`;
}

type CanonHelpMode = "text" | "full" | "json";

interface DetectedHelp {
  readonly mode: CanonHelpMode;
  readonly routeWords: readonly string[];
  readonly invalidMode?: string;
}

function declaredOptions<const Catalog extends CommandCatalog>(
  product: CompiledProduct<Catalog>,
): ReadonlyMap<string, CompiledField> {
  const options = new Map<string, CompiledField>();
  for (const command of product.commands) {
    for (const field of command.fields) {
      if ((field.kind === "option" || field.kind === "flag") && field.flag !== undefined) {
        options.set(field.flag, field);
        for (const alias of field.aliases ?? []) options.set(alias, field);
      }
    }
  }
  return options;
}

function detectHelp<const Catalog extends CommandCatalog>(
  product: CompiledProduct<Catalog>,
  argv: readonly string[],
): DetectedHelp | undefined {
  const delimiter = argv.indexOf("--");
  const end = delimiter === -1 ? argv.length : delimiter;
  const options = declaredOptions(product);
  const routeWords: string[] = [];
  let detected: DetectedHelp | undefined;

  for (let index = 0; index < end; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;
    if (token === "--help" || token === "-h" || token.startsWith("--help=")) {
      const value = token.startsWith("--help=") ? token.slice("--help=".length) : undefined;
      const validValue = value === undefined || value === "full" || value === "json";
      detected ??= {
        mode: value === "full" || value === "json" ? value : "text",
        routeWords,
        ...(validValue ? {} : { invalidMode: value }),
      };
      continue;
    }
    if (token === "--") break;

    const flag = token.startsWith("-") ? token.split("=", 1)[0] : undefined;
    const declaration = flag === undefined ? undefined : options.get(flag);
    const hasInlineValue = token.includes("=");
    if (declaration?.kind === "option" && !hasInlineValue) {
      const next = argv[index + 1];
      if (declaration.valueArity !== "optional" || (
        next !== undefined && (!next.startsWith("-") || /^-\d/u.test(next))
      )) {
        index += 1;
        continue;
      }
    }
    if (token.startsWith("-")) continue;
    routeWords.push(token);
  }

  return detected === undefined
    ? undefined
    : { ...detected, routeWords: Object.freeze([...routeWords]) };
}

function routeCandidates<const Catalog extends CommandCatalog>(
  product: CompiledProduct<Catalog>,
): readonly (readonly string[])[] {
  const candidates = new Map<string, readonly string[]>();
  for (const command of product.commands) {
    for (let length = 1; length <= command.route.length; length += 1) {
      const route = command.route.slice(0, length);
      candidates.set(route.join("\u0000"), route);
    }
  }
  return [...candidates.values()].sort((left, right) =>
    right.length - left.length || (left.join(" ") < right.join(" ") ? -1 : left.join(" ") > right.join(" ") ? 1 : 0),
  );
}

function helpRequest<const Catalog extends CommandCatalog>(
  product: CompiledProduct<Catalog>,
  words: readonly string[],
  mode: Exclude<CanonHelpMode, "json">,
): HelpRequest {
  const routes = routeCandidates(product);
  for (let start = 0; start < words.length; start += 1) {
    for (const route of routes) {
      if (route.every((segment, offset) => words[start + offset] === segment)) {
        const command = product.commands.find((candidate) =>
          candidate.route.length === route.length && candidate.route.every((segment, index) => route[index] === segment),
        );
        return command === undefined
          ? { kind: "route", route, mode }
          : { kind: "command", commandId: command.id, mode };
      }
    }
  }
  return { kind: "root", mode };
}

function helpDiscoveryRoute<const Catalog extends CommandCatalog>(
  product: CompiledProduct<Catalog>,
  request: HelpRequest,
): readonly string[] | undefined {
  if (request.kind === "route") return request.route;
  if (request.kind === "command") {
    return product.commands.find((command) => command.id === request.commandId)?.route;
  }
  return undefined;
}

export async function runNodeCli<const Catalog extends CommandCatalog>(
  product: CompiledProduct<Catalog>,
  argv: readonly string[],
  options: RunNodeCliOptions = {},
): Promise<CliResult> {
  const detectedHelp = detectHelp(product, argv);
  if (detectedHelp !== undefined) {
    if (detectedHelp.invalidMode !== undefined) {
      return {
        exitCode: 2,
        stdout: "",
        stderr: `Unknown help mode: ${detectedHelp.invalidMode}\n`,
        failureKind: "usage",
      };
    }
    const selectedMode = options.helpFormat ?? detectedHelp.mode;
    const request = helpRequest(product, detectedHelp.routeWords, selectedMode === "json" ? "text" : selectedMode);
    if (selectedMode === "json") {
      const route = helpDiscoveryRoute(product, request);
      return {
        exitCode: 0,
        stdout: `${JSON.stringify(projectDiscovery(product, route === undefined ? {} : { route }))}\n`,
        stderr: "",
      };
    }
    return { exitCode: 0, stdout: renderHelp(product, request), stderr: "" };
  }

  let stdout = "";
  let stderr = "";
  let invocation: Promise<CliResult> | undefined;
  const program = new Command(product.name);
  program.helpOption(false);
  program.addHelpCommand(false);
  program.exitOverride();
  program.configureOutput({
    writeOut: (value: string) => {
      stdout += value;
    },
    writeErr: (value: string) => {
      stderr += value;
    },
  });
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

          let decoded: Readonly<Record<string, unknown>>;
          try {
            decoded = await decodeInput(compiled, raw);
          } catch (error) {
            return {
              exitCode: 2,
              stdout: "",
              stderr: `INVALID_INPUT: ${error instanceof Error ? error.message : String(error)}\n`,
              failureKind: "validation" as const,
            };
          }

          const handler = product.handlers[compiled.id as keyof Catalog] as (
            input: Readonly<Record<string, unknown>>,
          ) => unknown;
          const rawResult = await handler(decoded);
          try {
            const result = await compiled.definition.result.parseAsync(rawResult);
            return { exitCode: 0, stdout: stringifyResult(result), stderr: "" };
          } catch (error) {
            return {
              exitCode: 1,
              stdout: "",
              stderr: `INVALID_HANDLER_RESULT: ${error instanceof Error ? error.message : String(error)}\n`,
              failureKind: "handler-result" as const,
            };
          }
        } catch (error) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `UNEXPECTED: ${error instanceof Error ? error.message : String(error)}\n`,
            failureKind: "unexpected" as const,
          };
        }
      })();
      await invocation;
    });
  }

  try {
    await program.parseAsync(["node", product.name, ...argv]);
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code === "commander.helpDisplayed") return { exitCode: 0, stdout, stderr };
      return {
        exitCode: error.exitCode === 0 ? 1 : error.exitCode,
        stdout,
        stderr,
        failureKind: "usage",
      };
    }
    return {
      exitCode: 1,
      stdout,
      stderr: `${stderr}UNEXPECTED: ${error instanceof Error ? error.message : String(error)}\n`,
      failureKind: "unexpected",
    };
  }

  return invocation === undefined
    ? { exitCode: 2, stdout, stderr: `${stderr}No command selected.\n`, failureKind: "usage" }
    : await invocation;
}
