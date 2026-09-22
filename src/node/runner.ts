import { Command, CommanderError, Option } from "commander";
import type { CompiledCommand, CompiledField, CompiledProduct } from "../command/compiler.js";
import type { CommandCatalog, FieldDefinition } from "../command/model.js";
import { projectDiscovery } from "../projection/discovery.js";

export type CliFailureKind = "usage" | "validation" | "handler-result" | "unexpected";

export interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly failureKind?: CliFailureKind;
}

export interface RunNodeCliOptions {
  readonly helpFormat?: "text" | "json";
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
  return `${prefix} <${field.metavar ?? field.key}>`;
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
      for (const item of values) parsed.push(await definition.schema.parseAsync(item));
      decoded[field.key] = parsed;
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
    if (field.kind === "positional") command.argument(`<${field.metavar ?? field.key}>`);
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

export async function runNodeCli<const Catalog extends CommandCatalog>(
  product: CompiledProduct<Catalog>,
  argv: readonly string[],
  options: RunNodeCliOptions = {},
): Promise<CliResult> {
  if (options.helpFormat === "json" && argv.includes("--help")) {
    return { exitCode: 0, stdout: `${JSON.stringify(projectDiscovery(product))}\n`, stderr: "" };
  }

  let stdout = "";
  let stderr = "";
  let invocation: Promise<CliResult> | undefined;
  const program = new Command(product.name);
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
