export const certificationOracle = {
  success: {
    exitCode: 0,
    stdout: '{"message":"shared scenario"}\n',
    stderr: "",
  },
  validation: {
    exitCode: 2,
    failureKind: "validation",
  },
  rootHelp: "Usage: fixture-cli <command>\n\nCommands:\n  echo\tEcho a message.\n",
  commandHelp: "Usage: fixture-cli echo <message>\n\nEcho a message.\n",
  discovery: {
    name: "fixture-cli",
    commands: [
      {
        id: "example.echo",
        route: ["echo"],
        summary: "Echo a message.",
        fields: [{ key: "message", kind: "positional", metavar: "message" }],
      },
    ],
  },
  jsonHelp: {
    exitCode: 0,
    discovery: {
      name: "fixture-cli",
      commands: [
        {
          id: "example.echo",
          route: ["echo"],
          summary: "Echo a message.",
          fields: [{ key: "message", kind: "positional", metavar: "message" }],
        },
      ],
    },
    trailingNewline: true,
  },
};
