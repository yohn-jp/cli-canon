import * as z from "zod";

export async function runCertificationScenario(api, node) {
  const commands = api.defineCommands({
    "example.echo": {
      route: ["echo"],
      summary: "Echo a message.",
      input: { message: api.positional(z.string().min(1), { metavar: "message" }) },
      result: z.object({ message: z.string() }),
    },
  });
  const handlers = api.bindHandlers(commands)({
    "example.echo": ({ message }) => ({ message }),
  });
  const product = api.compileProduct({ name: "fixture-cli", commands, handlers });
  const success = await node.runNodeCli(product, ["echo", "shared scenario"]);
  const validation = await node.runNodeCli(product, ["echo", ""]);
  const jsonHelp = await node.runNodeCli(product, ["--help"], { helpFormat: "json" });

  return {
    success,
    validation: {
      exitCode: validation.exitCode,
      failureKind: validation.failureKind,
    },
    rootHelp: api.renderHelp(product),
    commandHelp: api.renderHelp(product, { kind: "command", commandId: "example.echo" }),
    discovery: api.projectDiscovery(product),
    jsonHelp: {
      exitCode: jsonHelp.exitCode,
      discovery: JSON.parse(jsonHelp.stdout),
      trailingNewline: jsonHelp.stdout.endsWith("\n"),
    },
  };
}
