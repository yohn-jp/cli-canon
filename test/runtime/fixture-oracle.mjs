export const certificationOracle = {
  success: {
    exitCode: 0,
    stdout: '{"message":"shared scenario","suffix":"suffix","format":"full"}\n',
    stderr: "",
  },
  validation: {
    exitCode: 2,
    failureKind: "validation",
  },
  rootHelp: "Usage: fixture-cli <command>\n\nCommands:\n  echo\tEcho a message.\n\nHelp: --help[=full|json]\n",
  commandHelp: "Usage: fixture-cli echo <message> [<suffix>] [--format[=<format>]]\n\nEcho a message.\n\nHelp: --help[=full|json]\n",
  fullHelp: {
    exitCode: 0,
    includesDescription: true,
    includesExample: true,
  },
  discovery: {
    name: "fixture-cli",
    commands: [
      {
        id: "example.echo",
        route: ["echo"],
        summary: "Echo a message.",
        description: "Write the supplied message and its optional annotations.",
        examples: ["fixture-cli echo hello --format=full"],
        fields: [
          { key: "message", kind: "positional", required: true, description: "Message to write.", metavar: "message" },
          { key: "suffix", kind: "positional", required: false, description: "Optional suffix." },
          {
            key: "format",
            kind: "option",
            flag: "--format",
            aliases: [],
            placement: "after-route",
            description: "Choose an optional output format.",
            repeatable: false,
            required: false,
            valueArity: "optional",
            optionLookingValuePolicy: "consume",
          },
        ],
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
          description: "Write the supplied message and its optional annotations.",
          examples: ["fixture-cli echo hello --format=full"],
          fields: [
            { key: "message", kind: "positional", required: true, description: "Message to write.", metavar: "message" },
            { key: "suffix", kind: "positional", required: false, description: "Optional suffix." },
            {
              key: "format",
              kind: "option",
              flag: "--format",
              aliases: [],
              placement: "after-route",
              description: "Choose an optional output format.",
              repeatable: false,
              required: false,
              valueArity: "optional",
              optionLookingValuePolicy: "consume",
            },
          ],
        },
      ],
    },
    trailingNewline: true,
  },
};
export function certificationOracleFor(packageMetadata) {
  const projectedPackageMetadata = {
    name: packageMetadata.name,
    version: packageMetadata.version,
    ...(packageMetadata.bin === undefined ? {} : { bin: packageMetadata.bin }),
  };
  const discovery = {
    ...certificationOracle.discovery,
    packageMetadata: projectedPackageMetadata,
  };

  return {
    ...certificationOracle,
    discovery,
    jsonHelp: {
      ...certificationOracle.jsonHelp,
      discovery,
    },
  };
}

