import * as z from "zod";
import { certificationOracleFor } from "./fixture-oracle.mjs";

export async function runCertificationScenario(api, node, packageMetadata, input) {
  const commands = api.defineCommands({
    "example.echo": {
      route: ["echo"],
      summary: "Echo a message.",
      description: "Write the supplied message and its optional annotations.",
      examples: ["fixture-cli echo hello --format=full"],
      input: {
        message: api.positional(z.string().min(1), { metavar: "message", description: "Message to write." }),
        suffix: api.positional(z.string(), { required: false, description: "Optional suffix." }),
        format: api.option("--format", z.enum(["full", "json"]), {
          valueArity: "optional",
          description: "Choose an optional output format.",
        }),
      },
      result: z.object({ message: z.string(), suffix: z.string().optional(), format: z.string().optional() }),
    },
  });
  const handlers = api.bindHandlers(commands)({
    "example.echo": ({ message, suffix, format }) => ({ message, suffix, format }),
  });
  const product = api.compileProduct({ name: "fixture-cli", packageMetadata, commands, handlers });
  const success = await node.runNodeCli(product, ["echo", input.message, input.suffix, `--format=${input.format}`]);
  const validation = await node.runNodeCli(product, ["echo", ""]);
  const fullHelp = await node.runNodeCli(product, ["echo", "--help=full"]);
  const jsonHelp = await node.runNodeCli(product, ["--help=json"]);

  return {
    success,
    validation: {
      exitCode: validation.exitCode,
      failureKind: validation.failureKind,
    },
    rootHelp: api.renderHelp(product),
    commandHelp: api.renderHelp(product, { kind: "command", commandId: "example.echo" }),
    fullHelp: {
      exitCode: fullHelp.exitCode,
      includesDescription: fullHelp.stdout.includes("Optional suffix."),
      includesExample: fullHelp.stdout.includes("fixture-cli echo hello --format=full"),
    },
    discovery: api.projectDiscovery(product),
    jsonHelp: {
      exitCode: jsonHelp.exitCode,
      discovery: JSON.parse(jsonHelp.stdout),
      trailingNewline: jsonHelp.stdout.endsWith("\n"),
    },
  };
}

export function createCertificationScenario(packageMetadata, requiredLanes) {
  return {
    id: "echo CLI contract",
    commandId: "example.echo",
    input: { message: "shared scenario", suffix: "suffix", format: "full" },
    expected: certificationOracleFor(packageMetadata),
    requiredLanes,
    run: ({ api, node }, input) => runCertificationScenario(api, node, packageMetadata, input),
  };
}
