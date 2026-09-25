import assert from "node:assert/strict";
import test from "node:test";
import * as z from "zod";
import {
  CanonConstructionError,
  bindHandlers,
  compileProduct,
  composeCommandProjection,
  defineCommands,
  defineGroups,
  executeCanonicalCommand,
  flag,
  option,
  parseHelpMode,
  projectHelp,
  projectDiscovery,
  positional,
  renderHelp,
  textOutput,
} from "../../dist/index.js";
import { executeNodeCli, projectNodeCliExecution, runNodeCli } from "../../dist/node/index.js";

function architectureFixture() {
  const commands = defineCommands({
    "architecture.example": {
      route: ["architecture", "example"],
      summary: "Show an architecture example.",
      description: "Read one example from the canonical architecture.",
      examples: ["fixture architecture example --format=full"],
      input: {
        format: option("--format", z.enum(["full", "json"]), {
          valueArity: "optional",
          description: "Choose the example detail level.",
        }),
      },
      result: z.object({ rendered: z.string(), format: z.string() }),
    },
  });
  const handlers = bindHandlers(commands)({
    "architecture.example": ({ format }) => {
      if (format === "json") throw { code: "EXAMPLE_UNAVAILABLE" };
      return { rendered: format === "full" ? "full example" : "summary example", format: format ?? "summary" };
    },
  });
  const groups = defineGroups({ architecture: { route: ["architecture"], summary: "Browse architecture examples." } });
  const product = compileProduct({ name: "fixture", commands, handlers, groups });
  const legacyRoutes = [
    {
      id: "legacy.auth.login",
      route: ["auth", "login"],
      summary: "Sign in to a service.",
      fields: [
        {
          key: "account",
          kind: "option",
          flag: "--account",
          aliases: [],
          repeatable: false,
          required: true,
          valueArity: "required",
          optionLookingValuePolicy: "consume",
          placement: "after-route",
        },
      ],
    },
    {
      id: "legacy.architecture.zones",
      route: ["architecture", "zones"],
      summary: "List architecture zones.",
      fields: [],
    },
    {
      id: "legacy.guide",
      route: ["guide"],
      summary: "Open the product guide.",
      fields: [],
    },
  ];
  return { product, legacyRoutes };
}

function usageFixture() {
  const commands = defineCommands({
    "document.render": {
      route: ["render"],
      summary: "Render one document.",
      input: {
        file: positional(z.string()),
        out: option("--out", z.string(), { required: true }),
      },
      result: z.object({ written: z.string() }),
    },
  });
  return compileProduct({
    name: "fixture",
    commands,
    handlers: bindHandlers(commands)({ "document.render": ({ out }) => ({ written: out }) }),
  });
}

const domainErrorAdapter = {
  is: (error) => typeof error === "object" && error !== null && "code" in error && error.code === "EXAMPLE_UNAVAILABLE",
  map: (error) => ({ exitCode: 7, stream: "stderr", output: `${error.code}: example is unavailable\n` }),
};

test("mixed route projection composes summary, full, and JSON help from one bounded descriptor set", async () => {
  const { product, legacyRoutes } = architectureFixture();
  const projection = composeCommandProjection(product, legacyRoutes);

  const root = renderHelp(projection);
  assert.match(root, /architecture\tBrowse architecture examples\./);
  assert.match(root, /auth login\tSign in to a service\./);
  assert.match(root, /guide\tOpen the product guide\./);
  assert.deepEqual(
    projectDiscovery(projection, { route: ["architecture"] }).commands.map(({ id }) => id),
    ["architecture.example", "legacy.architecture.zones"],
  );

  const parsed = parseHelpMode(projection, ["architecture", "example", "--help=full"]);
  assert.equal(parsed?.mode, "full");
  assert.equal(parsed?.request.kind, "command");
  assert.match(projectHelp(projection, parsed), /Choose the example detail level\./);

  const summary = await runNodeCli(product, ["architecture", "example", "--help"], { legacyRoutes });
  assert.equal(summary.exitCode, 0);
  assert.equal(summary.stderr, "");
  assert.match(summary.stdout, /Usage: fixture architecture example/);
  assert.doesNotMatch(summary.stdout, /Read one example from the canonical architecture\./);

  const full = await runNodeCli(product, ["architecture", "example", "--help=full"], { legacyRoutes });
  assert.equal(full.exitCode, 0);
  assert.equal(full.stderr, "");
  assert.match(full.stdout, /Read one example from the canonical architecture\./);
  assert.match(full.stdout, /fixture architecture example --format=full/);

  const domain = await runNodeCli(product, ["architecture", "--help"], { legacyRoutes });
  assert.equal(domain.exitCode, 0);
  assert.equal(domain.stderr, "");
  assert.match(domain.stdout, /example\tShow an architecture example\./);
  assert.match(domain.stdout, /zones\tList architecture zones\./);

  const rootJson = await runNodeCli(product, ["--help=json"], { legacyRoutes });
  assert.equal(rootJson.exitCode, 0);
  assert.deepEqual(
    JSON.parse(rootJson.stdout).commands.map(({ id }) => id),
    ["architecture.example", "legacy.architecture.zones", "legacy.auth.login", "legacy.guide"],
  );

  const leafJson = await runNodeCli(product, ["architecture", "example", "--help=json"], { legacyRoutes });
  assert.deepEqual(
    JSON.parse(leafJson.stdout).commands.map(({ id }) => id),
    ["architecture.example"],
  );
});

test("terminal adapter can render consumer help from Canon-resolved metadata without reparsing argv", async () => {
  const { product, legacyRoutes } = architectureFixture();
  const terminal = await runNodeCli(product, ["architecture", "example", "--help"], {
    legacyRoutes,
    terminalAdapter: {
      help: ({ mode, request, discovery }) => {
        assert.equal(mode, "summary");
        assert.equal(request.kind, "command");
        assert.equal(request.commandId, "architecture.example");
        const command = discovery.commands[0];
        assert.equal(command?.id, "architecture.example");
        assert.deepEqual(command?.route, ["architecture", "example"]);
        assert.equal(command?.summary, "Show an architecture example.");
        assert.deepEqual(command?.examples, ["fixture architecture example --format=full"]);
        return textOutput(
          [
            "Fixture help (urn:fixture:command-contract:1.0.0)",
            "",
            `Usage: fixture ${command.route.join(" ")} [--help[=full|json]]`,
            command.summary,
            "",
            "Options:",
            "  --help[=full|json]  Show progressive help; use --help=full for the complete command reference or --help=json for discovery.",
            "",
            "Examples:",
            `  ${command.examples[0]}`,
            "",
          ].join("\n"),
        );
      },
    },
  });

  assert.deepEqual(terminal, {
    exitCode: 0,
    stdout:
      "Fixture help (urn:fixture:command-contract:1.0.0)\n\n" +
      "Usage: fixture architecture example [--help[=full|json]]\n" +
      "Show an architecture example.\n\n" +
      "Options:\n" +
      "  --help[=full|json]  Show progressive help; use --help=full for the complete command reference or --help=json for discovery.\n\n" +
      "Examples:\n" +
      "  fixture architecture example --format=full\n",
    stderr: "",
  });
});

test("mixed route composition rejects duplicate and overlapping ownership deterministically", () => {
  const { product, legacyRoutes } = architectureFixture();
  const descriptor = (id, route) => ({ id, route, summary: "Legacy route.", fields: [] });

  assert.throws(
    () => composeCommandProjection(product, [...legacyRoutes, descriptor("legacy.same", ["architecture", "example"])]),
    (error) => error instanceof CanonConstructionError && error.issues[0]?.code === "DUPLICATE_ROUTE",
  );
  assert.throws(
    () => composeCommandProjection(product, [...legacyRoutes, descriptor("legacy.parent", ["architecture"])]),
    (error) =>
      error instanceof CanonConstructionError &&
      error.issues[0]?.code === "OVERLAPPING_ROUTE" &&
      error.issues.some((issue) => issue.code === "AMBIGUOUS_ROUTE_OWNERSHIP" && issue.commandId === "legacy.parent"),
  );
  assert.throws(
    () => composeCommandProjection(product, [descriptor("legacy.child", ["architecture", "example", "details"])]),
    (error) => error instanceof CanonConstructionError && error.issues[0]?.code === "OVERLAPPING_ROUTE",
  );
  assert.throws(
    () => composeCommandProjection(product, [descriptor("architecture.example", ["guide"])]),
    (error) => error instanceof CanonConstructionError && error.issues[0]?.code === "DUPLICATE_COMMAND_ID",
  );
});

test("execution exposes the validated typed result before terminal projection", async () => {
  const { product, legacyRoutes } = architectureFixture();
  const execution = await executeNodeCli(product, ["architecture", "example"], { legacyRoutes });
  assert.deepEqual(execution, {
    status: "success",
    commandId: "architecture.example",
    result: { rendered: "summary example", format: "summary" },
  });

  const terminal = projectNodeCliExecution(execution, {
    terminalAdapter: {
      success: ({ result }) => textOutput(`${result.rendered}\n`),
    },
  });
  assert.deepEqual(terminal, { exitCode: 0, stdout: "summary example\n", stderr: "" });

  const domainExecution = await executeNodeCli(product, ["architecture", "example", "--format=json"]);
  const domainTerminal = projectNodeCliExecution(domainExecution, { domainErrorAdapter });
  assert.deepEqual(domainTerminal, {
    exitCode: 7,
    stdout: "",
    stderr: "EXAMPLE_UNAVAILABLE: example is unavailable\n",
    failureKind: "domain",
  });
});

test("parser failures carry source classification and project to stable terminal streams and exit codes", async () => {
  const product = usageFixture();
  let domainErrorChecks = 0;
  const domainAdapter = {
    is: () => {
      domainErrorChecks += 1;
      return false;
    },
    map: () => ({ exitCode: 9, stream: "stderr", output: "unexpected domain mapping\n" }),
  };
  const cases = [
    [["render", "input.txt", "extra", "--out", "out.txt"], "extra-positional-argument", "commander.excessArguments"],
    [["render", "input.txt", "--out", "out.txt", "--unknown"], "unknown-option", "commander.unknownOption"],
    [["render", "input.txt", "--out"], "missing-option-value", "commander.optionMissingArgument"],
    [["render", "input.txt"], "missing-required-option", "commander.missingMandatoryOptionValue"],
  ];

  for (const [argv, code, parserCode] of cases) {
    const execution = await executeNodeCli(product, argv);
    assert.equal(execution.status, "failure");
    assert.equal(execution.failureKind, "usage");
    assert.equal(execution.usageFailure.code, code);
    assert.equal(execution.usageFailure.parserCode, parserCode);
    const terminal = projectNodeCliExecution(execution, { domainErrorAdapter: domainAdapter });
    assert.equal(terminal.exitCode, 2);
    assert.equal(terminal.stdout, "");
    assert.equal(terminal.failureKind, "usage");
    assert.notEqual(terminal.stderr, "");
  }
  assert.equal(domainErrorChecks, 0, "usage failures never enter domain error mapping");

  const invalidHelp = await executeNodeCli(product, ["render", "--help=brief"]);
  assert.equal(invalidHelp.status, "failure");
  assert.equal(invalidHelp.failureKind, "usage");
  assert.equal(invalidHelp.usageFailure.code, "invalid-help-mode");
  assert.deepEqual(projectNodeCliExecution(invalidHelp), {
    exitCode: 2,
    stdout: "",
    stderr: "Unknown help mode: brief\n",
    failureKind: "usage",
  });
});

function runtimeFixture() {
  const calls = [];
  const commands = defineCommands({
    "document.render": {
      route: ["document", "render"],
      summary: "Render one document.",
      input: {
        file: positional(z.string().min(1)),
        count: option("--count", z.coerce.number().int(), { required: true }),
        scope: option("--scope", z.string(), { required: true, placement: "anywhere" }),
        verbose: flag("--verbose"),
      },
      result: z.object({ file: z.string(), count: z.number(), scope: z.string(), verbose: z.boolean() }),
    },
  });
  const groups = defineGroups({ document: { route: ["document"], summary: "Work with documents." } });
  const product = compileProduct({
    name: "fixture",
    commands,
    groups,
    handlers: bindHandlers(commands)({
      "document.render": (input) => {
        calls.push(input);
        return input;
      },
    }),
  });
  return { product, calls };
}

test("Node execution delegates route resolution, required input, and decoding to the semantic runtime", async () => {
  const { product, calls } = runtimeFixture();
  const request = {
    route: ["document", "render"],
    input: { file: "input.md", count: "3", scope: "team", verbose: true },
  };

  const execution = await executeNodeCli(product, [
    "--scope",
    "team",
    "document",
    "render",
    "input.md",
    "--count",
    "3",
    "--verbose",
  ]);
  const canonical = await executeCanonicalCommand(product, request);
  assert.equal(canonical.status, "success");
  assert.deepEqual(execution, { status: "success", commandId: canonical.commandId, result: canonical.result });
  assert.deepEqual(calls, [
    { file: "input.md", count: 3, scope: "team", verbose: true },
    { file: "input.md", count: 3, scope: "team", verbose: true },
  ]);

  calls.length = 0;
  const invalid = await executeNodeCli(product, [
    "document",
    "render",
    "input.md",
    "--count",
    "many",
    "--scope",
    "team",
  ]);
  assert.equal(invalid.status, "failure");
  assert.equal(invalid.failureKind, "validation");
  assert.deepEqual(calls, [], "decode failures stop before the handler");

  const missingAnywhere = await executeNodeCli(product, ["document", "render", "input.md", "--count", "3"]);
  assert.deepEqual(missingAnywhere, {
    status: "failure",
    failureKind: "usage",
    usageFailure: { code: "missing-required-option", commandId: "document.render", option: "--scope" },
  });
});

test("structured usage corpus never inspects parser messages or enters domain-error mapping", async () => {
  const { product, calls } = runtimeFixture();
  let domainErrorChecks = 0;
  const domainAdapter = {
    is: () => {
      domainErrorChecks += 1;
      return true;
    },
    map: () => ({ exitCode: 9, stream: "stderr", output: "domain\n" }),
  };
  const cases = [
    [[], { code: "no-command" }],
    [["document"], { code: "no-command" }],
    [["--scope", "team", "document"], { code: "no-command" }],
    [["missing"], { code: "unknown-command", parserCode: "commander.unknownCommand" }],
    [["document", "missing"], { code: "unknown-command", parserCode: "commander.unknownCommand" }],
    [
      ["document", "render", "a", "b", "--count", "1", "--scope", "x"],
      { code: "extra-positional-argument", parserCode: "commander.excessArguments" },
    ],
    [
      ["document", "render", "a", "--count", "1", "--scope", "x", "--nope"],
      { code: "unknown-option", parserCode: "commander.unknownOption" },
    ],
    [
      ["document", "render", "a", "--scope", "x", "--count"],
      { code: "missing-option-value", parserCode: "commander.optionMissingArgument" },
    ],
    [
      ["document", "render", "a", "--scope", "x"],
      { code: "missing-required-option", parserCode: "commander.missingMandatoryOptionValue" },
    ],
    [
      ["document", "render", "--count", "1", "--scope", "x"],
      { code: "missing-positional-argument", parserCode: "commander.missingArgument" },
    ],
    [["document", "render", "--help=brief"], { code: "invalid-help-mode", value: "brief" }],
  ];

  for (const [argv, usageFailure] of cases) {
    const execution = await executeNodeCli(product, argv);
    assert.deepEqual(execution, { status: "failure", failureKind: "usage", usageFailure }, argv.join(" "));
    const terminal = projectNodeCliExecution(execution, { domainErrorAdapter: domainAdapter });
    assert.equal(terminal.exitCode, 2, argv.join(" "));
    assert.equal(terminal.failureKind, "usage", argv.join(" "));
  }
  assert.equal(domainErrorChecks, 0, "usage failures never enter domain error mapping");
  assert.deepEqual(calls, []);
});

test("help intent resolves on one Canon path at any token placement without invoking handlers", async () => {
  const { product, calls } = runtimeFixture();
  const cases = [
    [["-h"], { kind: "root", mode: "text" }, "summary"],
    [["document", "--help"], { kind: "route", route: ["document"], mode: "text" }, "summary"],
    [["--help=full", "document", "render"], { kind: "command", commandId: "document.render", mode: "full" }, "full"],
    [
      ["document", "render", "input.md", "--count", "3", "-h"],
      { kind: "command", commandId: "document.render", mode: "text" },
      "summary",
    ],
    [
      ["--scope", "team", "document", "render", "--help=json"],
      { kind: "command", commandId: "document.render", mode: "text" },
      "json",
    ],
  ];
  for (const [argv, request, mode] of cases) {
    const execution = await executeNodeCli(product, argv);
    assert.equal(execution.status, "help", argv.join(" "));
    assert.equal(execution.mode, mode, argv.join(" "));
    assert.deepEqual(execution.request, request, argv.join(" "));
  }
  assert.deepEqual(calls, []);
});

test("framework failures outside handlers project as unexpected without domain-error mapping", async () => {
  const commands = defineCommands({
    read: { route: ["read"], summary: "Read.", input: {}, result: z.object({}) },
  });
  const product = compileProduct({ name: "fixture", commands, handlers: bindHandlers(commands)({ read: () => ({}) }) });
  const unbound = { ...product, handlers: {} };
  let domainErrorChecks = 0;
  const execution = await executeNodeCli(unbound, ["read"]);
  assert.equal(execution.status, "failure");
  assert.equal(execution.failureKind, "unexpected");
  const terminal = projectNodeCliExecution(execution, {
    domainErrorAdapter: {
      is: () => {
        domainErrorChecks += 1;
        return true;
      },
      map: () => ({ exitCode: 9, stream: "stderr", output: "domain\n" }),
    },
  });
  assert.equal(terminal.failureKind, "unexpected");
  assert.equal(terminal.exitCode, 1);
  assert.equal(domainErrorChecks, 0);
});
