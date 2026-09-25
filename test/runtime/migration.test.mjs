import assert from "node:assert/strict";
import test from "node:test";
import * as z from "zod";
import {
  CanonConstructionError,
  bindHandlers,
  compileProduct,
  composeCommandProjection,
  composeCommandSources,
  defineCommands,
  defineGroups,
  executeCanonicalArgv,
  executeCanonicalCommand,
  executeComposedArgv,
  flag,
  option,
  parseHelpMode,
  projectHelp,
  projectComposedCommandTree,
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

test("Canon owns standard help and special terminal surfaces are explicit", async () => {
  const { product, legacyRoutes } = architectureFixture();

  let legacyHelpCalls = 0;
  const canonical = await runNodeCli(product, ["architecture", "example", "--help"], {
    legacyRoutes,
    terminalAdapter: {
      help: () => {
        legacyHelpCalls += 1;
        return textOutput("legacy help\n");
      },
    },
  });
  assert.equal(canonical.exitCode, 0);
  assert.match(canonical.stdout, /Usage: fixture architecture example/);
  assert.doesNotMatch(canonical.stdout, /legacy help/);
  assert.equal(legacyHelpCalls, 0);

  const legacyUsage = await runNodeCli(product, ["architecture", "example", "--unknown-option"], {
    legacyRoutes,
    terminalAdapter: {
      usageFailure: () => {
        legacyHelpCalls += 1;
        return textOutput("legacy usage\n");
      },
    },
  });
  assert.equal(legacyUsage.exitCode, 2);
  assert.match(legacyUsage.stderr, /^error: /);
  assert.match(legacyUsage.stderr, /Usage: fixture architecture example/);
  assert.doesNotMatch(legacyUsage.stderr, /legacy usage/);
  assert.equal(legacyHelpCalls, 0);

  const specialUsage = await runNodeCli(product, ["architecture", "example", "--unknown-option"], {
    legacyRoutes,
    specialTerminalSurface: {
      usageFailure: (failure) => textOutput(`special ${failure.code}\n`),
    },
  });
  assert.equal(specialUsage.exitCode, 0);
  assert.equal(specialUsage.stdout, "special unknown-option\n");
  assert.equal(specialUsage.stderr, "");

  const terminal = await runNodeCli(product, ["architecture", "example", "--help"], {
    legacyRoutes,
    specialTerminalSurface: {
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
    resultPresenter: {
      success: ({ result }) => textOutput(`${result.rendered}\n`),
    },
  });
  assert.deepEqual(terminal, { exitCode: 0, stdout: "summary example\n", stderr: "" });

  const compatibleTerminal = projectNodeCliExecution(execution, {
    terminalAdapter: {
      success: ({ result }) => textOutput(`${result.rendered}\n`),
    },
  });
  assert.deepEqual(compatibleTerminal, terminal);

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
  const commandUsage = "Usage: fixture render <file> --out <out>";
  const rootUsage = "Usage: fixture <command>";
  const cases = [
    {
      argv: ["render", "input.txt", "extra", "--out", "out.txt"],
      code: "extra-positional-argument",
      parserCode: "commander.excessArguments",
      message: "too many arguments",
      usage: commandUsage,
    },
    {
      argv: ["render", "input.txt", "--out", "out.txt", "--unknown"],
      code: "unknown-option",
      parserCode: "commander.unknownOption",
      message: "unknown option",
      usage: commandUsage,
    },
    {
      argv: ["render", "input.txt", "--out"],
      code: "missing-option-value",
      parserCode: "commander.optionMissingArgument",
      message: "option value missing",
      usage: commandUsage,
    },
    {
      argv: ["render", "input.txt"],
      code: "missing-required-option",
      parserCode: "commander.missingMandatoryOptionValue",
      message: "required option not specified",
      usage: commandUsage,
    },
    {
      argv: ["render", "--out", "out.txt"],
      code: "missing-positional-argument",
      parserCode: "commander.missingArgument",
      message: "required argument missing",
      usage: commandUsage,
    },
    { argv: ["missing"], code: "unknown-command", message: "unknown command", usage: rootUsage },
    { argv: [], code: "no-command", message: "no command selected", usage: rootUsage },
    {
      argv: ["render", "--help=brief"],
      code: "invalid-help-mode",
      message: 'unknown help mode "brief"',
      usage: rootUsage,
    },
  ];

  for (const { argv, code, parserCode, message, usage } of cases) {
    const execution = await executeNodeCli(product, argv);
    assert.equal(execution.status, "failure");
    assert.equal(execution.failureKind, "usage");
    assert.equal(execution.usageFailure.code, code);
    if (parserCode !== undefined) {
      assert.equal(execution.usageFailure.parserCode, parserCode);
      assert.equal(execution.usageFailure.commandId, "document.render");
    }
    assert.equal(`Usage: ${execution.usage.join(" ")}`, usage);
    assert.deepEqual(projectNodeCliExecution(execution, { domainErrorAdapter: domainAdapter }), {
      exitCode: 2,
      stdout: "",
      stderr: `error: ${message}\n\n${usage}\n`,
      failureKind: "usage",
    });
  }
  assert.equal(domainErrorChecks, 0, "usage failures never enter domain error mapping");
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
    usage: ["fixture", "document", "render", "<file>", "--count <count>", "--scope <scope>", "[--verbose]"],
  });
  assert.deepEqual(projectNodeCliExecution(missingAnywhere), {
    exitCode: 2,
    stdout: "",
    stderr:
      "error: required option '--scope' not specified\n\n" +
      "Usage: fixture document render <file> --count <count> --scope <scope> [--verbose]\n",
    failureKind: "usage",
  });
});

function recordingBackend(commandInput = () => ({})) {
  const calls = [];
  return {
    calls,
    backend: {
      parseLeading(scope, argv) {
        calls.push(["leading", scope, [...argv]]);
        return { status: "parsed", operands: argv, state: "root-state" };
      },
      parseCommand(node, argv, root) {
        calls.push(["command", node.id, [...argv], root]);
        return { status: "parsed", input: commandInput(argv) };
      },
    },
  };
}

test("argv resolves help, command, unknown, and no-command on the canonical runtime path", async () => {
  const { product, calls: handlerCalls } = runtimeFixture();
  const help = composeCommandProjection(product, []);
  const run = async (argv, commandInput) => {
    const recording = recordingBackend(commandInput);
    const outcome = await executeCanonicalArgv(product, { argv, backend: recording.backend, help });
    return { outcome, calls: recording.calls };
  };

  const helpIntent = await run(["document", "render", "input.md", "-h"]);
  assert.deepEqual(helpIntent.outcome, {
    status: "help",
    help: { mode: "summary", request: { kind: "command", commandId: "document.render", mode: "text" } },
  });
  assert.deepEqual(helpIntent.calls, [], "help intent resolves before any backend grammar parsing");

  const invalidHelp = await run(["--help=brief"]);
  assert.deepEqual(invalidHelp.outcome, {
    status: "failure",
    failureKind: "usage",
    usageFailure: { code: "invalid-help-mode", route: [], value: "brief" },
  });
  assert.deepEqual(invalidHelp.calls, []);

  const command = await run(["document", "render", "input.md"], ([file]) => ({ file, count: "3", scope: "team" }));
  assert.deepEqual(command.outcome, {
    status: "success",
    commandId: "document.render",
    route: ["document", "render"],
    result: { file: "input.md", count: 3, scope: "team", verbose: false },
  });
  assert.deepEqual(command.calls, [
    ["leading", { kind: "root" }, ["document", "render", "input.md"]],
    ["leading", { kind: "group", route: ["document"] }, ["render", "input.md"]],
    ["command", "document.render", ["input.md"], "root-state"],
  ]);

  const unknown = await run(["document", "missing", "input.md"]);
  assert.deepEqual(unknown.outcome, {
    status: "failure",
    failureKind: "usage",
    usageFailure: { code: "unknown-command", route: ["document", "missing"] },
  });
  assert.equal(
    unknown.calls.some(([kind]) => kind === "command"),
    false,
  );

  for (const [argv, route] of [
    [[], []],
    [["document"], ["document"]],
  ]) {
    const noCommand = await run(argv);
    assert.deepEqual(noCommand.outcome, {
      status: "failure",
      failureKind: "usage",
      usageFailure: { code: "no-command", route },
    });
    assert.equal(
      noCommand.calls.some(([kind]) => kind === "command"),
      false,
    );
  }

  const grammar = await executeCanonicalArgv(product, {
    argv: ["--nope"],
    help,
    backend: {
      parseLeading: () => ({ status: "failure", failure: { code: "unknown-option" } }),
      parseCommand: () => assert.fail("grammar failures stop before command parsing"),
    },
  });
  assert.deepEqual(grammar, { status: "failure", failureKind: "grammar", grammarFailure: { code: "unknown-option" } });
  assert.equal(handlerCalls.length, 1);
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
    [["missing"], { code: "unknown-command" }],
    [["document", "missing"], { code: "unknown-command" }],
    [
      ["document", "render", "a", "b", "--count", "1", "--scope", "x"],
      { code: "extra-positional-argument", parserCode: "commander.excessArguments", commandId: "document.render" },
    ],
    [
      ["document", "render", "a", "--count", "1", "--scope", "x", "--nope"],
      { code: "unknown-option", parserCode: "commander.unknownOption", commandId: "document.render" },
    ],
    [
      ["document", "render", "a", "--scope", "x", "--count"],
      { code: "missing-option-value", parserCode: "commander.optionMissingArgument", commandId: "document.render" },
    ],
    [
      ["document", "render", "a", "--scope", "x"],
      {
        code: "missing-required-option",
        parserCode: "commander.missingMandatoryOptionValue",
        commandId: "document.render",
      },
    ],
    [
      ["document", "render", "--count", "1", "--scope", "x"],
      { code: "missing-positional-argument", parserCode: "commander.missingArgument", commandId: "document.render" },
    ],
    [["document", "render", "--help=brief"], { code: "invalid-help-mode", value: "brief" }],
  ];

  for (const [argv, usageFailure] of cases) {
    const execution = await executeNodeCli(product, argv);
    assert.equal(execution.status, "failure", argv.join(" "));
    assert.equal(execution.failureKind, "usage", argv.join(" "));
    assert.deepEqual(execution.usageFailure, usageFailure, argv.join(" "));
    assert.ok(execution.usage.length > 0, argv.join(" "));
    const terminal = projectNodeCliExecution(execution, { domainErrorAdapter: domainAdapter });
    assert.equal(terminal.exitCode, 2, argv.join(" "));
    assert.equal(terminal.failureKind, "usage", argv.join(" "));
  }
  const groupNoCommand = await executeNodeCli(product, ["document"]);
  assert.deepEqual(groupNoCommand.usage, ["fixture", "document", "<command>"]);
  assert.deepEqual(projectNodeCliExecution(groupNoCommand), {
    exitCode: 2,
    stdout: "",
    stderr: "error: no command selected\n\nUsage: fixture document <command>\n",
    failureKind: "usage",
  });
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

/** Canon-owned and delegated routes, including siblings under the shared `architecture` group. */
function composedFixture({ executorThrows = false } = {}) {
  const handlerCalls = [];
  const commands = defineCommands({
    "architecture.example": {
      route: ["architecture", "example"],
      summary: "Show an architecture example.",
      input: {
        format: option("--format", z.enum(["full", "json"]), { valueArity: "optional" }),
      },
      result: z.object({ rendered: z.string() }),
    },
  });
  const handlers = bindHandlers(commands)({
    "architecture.example": ({ format }) => {
      handlerCalls.push(format);
      if (format === "json") throw { code: "EXAMPLE_UNAVAILABLE" };
      return { rendered: format === "full" ? "full example" : "summary example" };
    },
  });
  const groups = defineGroups({ architecture: { route: ["architecture"], summary: "Browse architecture examples." } });
  const product = compileProduct({ name: "fixture", commands, handlers, groups });
  const executorCalls = [];
  const delegated = {
    kind: "delegated",
    id: "external",
    groups: [{ id: "external.auth", route: ["auth"], summary: "Manage sign-in." }],
    commands: [
      {
        id: "external.architecture.zones",
        route: ["architecture", "zones"],
        summary: "List architecture zones.",
        fields: [],
      },
      {
        id: "external.auth.login",
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
    ],
    execute: (request) => {
      executorCalls.push(request);
      if (executorThrows) throw { code: "DELEGATED_FAILED" };
      return { exitCode: 0, stdout: `${request.commandId} ${request.argv.join(" ")}\n`, stderr: "" };
    },
  };
  return { product, delegated, handlerCalls, executorCalls };
}

test("incremental delegated sources project root, group, command, and JSON help from the resolved tree", async () => {
  const { product, delegated, handlerCalls, executorCalls } = composedFixture();
  const canonical = { kind: "canonical", id: product.name, product };
  const projection = projectComposedCommandTree(composeCommandSources([canonical, delegated]), { name: product.name });
  const reversedProjection = projectComposedCommandTree(composeCommandSources([delegated, canonical]), {
    name: product.name,
  });

  const root = renderHelp(projection);
  assert.match(root, /architecture\tBrowse architecture examples\./);
  assert.match(root, /auth\tManage sign-in\./);
  assert.equal(root, renderHelp(reversedProjection), "source declaration order does not change help order");

  const group = renderHelp(projection, { kind: "route", route: ["architecture"] });
  assert.match(group, /example\tShow an architecture example\./);
  assert.match(group, /zones\tList architecture zones\./);
  assert.match(
    renderHelp(projection, { kind: "command", commandId: "external.architecture.zones" }),
    /fixture architecture zones/,
  );

  const parsedGroupJson = parseHelpMode(projection, ["architecture", "--help=json"]);
  assert.equal(parsedGroupJson?.mode, "json");
  assert.deepEqual(
    projectHelp(projection, parsedGroupJson).commands.map(({ id }) => id),
    ["architecture.example", "external.architecture.zones"],
  );
  const rootJson = projectHelp(projection, parseHelpMode(projection, ["--help=json"]));
  assert.deepEqual(
    rootJson.commands.map(({ id }) => id),
    ["architecture.example", "external.architecture.zones", "external.auth.login"],
  );

  assert.deepEqual(handlerCalls, [], "projection does not invoke canonical handlers");
  assert.deepEqual(executorCalls, [], "projection does not invoke delegated executors");

  const runtimeGroup = await runNodeCli(product, ["architecture", "--help"], { delegatedSources: [delegated] });
  assert.match(runtimeGroup.stdout, /zones\tList architecture zones\./);
  const runtimeJson = await runNodeCli(product, ["--help=json"], { delegatedSources: [delegated] });
  assert.deepEqual(
    JSON.parse(runtimeJson.stdout).commands.map(({ id }) => id),
    ["architecture.example", "external.architecture.zones", "external.auth.login"],
  );
  assert.deepEqual(handlerCalls, [], "runtime help does not invoke canonical handlers");
  assert.deepEqual(executorCalls, [], "runtime help does not invoke delegated executors");
});

test("composed dispatch executes Canon-owned routes through the semantic runtime only", async () => {
  const { product, delegated, handlerCalls, executorCalls } = composedFixture();
  const execution = await executeNodeCli(product, ["architecture", "example", "--format=full"], {
    delegatedSources: [delegated],
  });
  assert.deepEqual(execution, {
    status: "success",
    commandId: "architecture.example",
    result: { rendered: "full example" },
  });
  assert.deepEqual(handlerCalls, ["full"]);
  assert.deepEqual(executorCalls, [], "canonical owners never cross the delegated executor boundary");
});

test("composed dispatch invokes only the declared delegated executor for delegated routes", async () => {
  const { product, delegated, handlerCalls, executorCalls } = composedFixture();
  const result = await runNodeCli(product, ["auth", "login", "--account", "team"], { delegatedSources: [delegated] });
  assert.deepEqual(result, { exitCode: 0, stdout: "external.auth.login --account team\n", stderr: "" });
  assert.deepEqual(executorCalls, [
    { sourceId: "external", commandId: "external.auth.login", route: ["auth", "login"], argv: ["--account", "team"] },
  ]);
  assert.deepEqual(handlerCalls, []);
});

test("shared-group canonical and delegated siblings resolve to their own owners", async () => {
  const { product, delegated, handlerCalls, executorCalls } = composedFixture();
  const options = { delegatedSources: [delegated] };

  const canonical = await executeNodeCli(product, ["architecture", "example"], options);
  assert.equal(canonical.status, "success");
  assert.equal(canonical.commandId, "architecture.example");

  const external = await executeNodeCli(product, ["architecture", "zones", "--all"], options);
  assert.deepEqual(external, {
    status: "delegated",
    sourceId: "external",
    commandId: "external.architecture.zones",
    result: { exitCode: 0, stdout: "external.architecture.zones --all\n", stderr: "" },
  });
  assert.deepEqual(handlerCalls, [undefined]);
  assert.deepEqual(
    executorCalls.map(({ commandId, route }) => [commandId, route]),
    [["external.architecture.zones", ["architecture", "zones"]]],
  );

  const group = await runNodeCli(product, ["architecture", "--help"], options);
  assert.equal(group.exitCode, 0);
  assert.match(group.stdout, /example\tShow an architecture example\./);
  assert.match(group.stdout, /zones\tList architecture zones\./);
  assert.equal(executorCalls.length, 1);
});

test("unknown-command is reported only after resolution fails across all composed sources", async () => {
  const { product, delegated, handlerCalls, executorCalls } = composedFixture();
  for (const [argv, route, usage] of [
    [["missing"], ["missing"], ["fixture", "<command>"]],
    [
      ["architecture", "missing"],
      ["architecture", "missing"],
      ["fixture", "architecture", "<command>"],
    ],
    [
      ["auth", "logout"],
      ["auth", "logout"],
      ["fixture", "auth", "<command>"],
    ],
  ]) {
    const execution = await executeNodeCli(product, argv, { delegatedSources: [delegated] });
    assert.deepEqual(
      execution,
      { status: "failure", failureKind: "usage", usageFailure: { code: "unknown-command" }, usage },
      argv.join(" "),
    );
    const outcome = await executeComposedArgv(
      { tree: composeCommandSources([{ kind: "canonical", id: "fixture", product }, delegated]), sources: [delegated] },
      { argv, backend: recordingBackend().backend, help: product },
    );
    assert.deepEqual(outcome, {
      status: "failure",
      failureKind: "usage",
      usageFailure: { code: "unknown-command", route },
    });
  }
  for (const [argv, usage] of [
    [["architecture"], ["fixture", "architecture", "<command>"]],
    [["auth"], ["fixture", "auth", "<command>"]],
    [[], ["fixture", "<command>"]],
  ]) {
    const execution = await executeNodeCli(product, argv, { delegatedSources: [delegated] });
    assert.deepEqual(execution.usageFailure, { code: "no-command" }, argv.join(" "));
    assert.deepEqual(execution.usage, usage, argv.join(" "));
  }
  assert.deepEqual(handlerCalls, []);
  assert.deepEqual(executorCalls, []);
});

test("no canonical usage, validation, or domain failure falls back to a delegated source", async () => {
  const { product, delegated, handlerCalls, executorCalls } = composedFixture();
  const options = { delegatedSources: [delegated] };

  const domain = await executeNodeCli(product, ["architecture", "example", "--format=json"], options);
  assert.equal(domain.status, "failure");
  assert.equal(domain.failureKind, "handler-error");
  assert.deepEqual(projectNodeCliExecution(domain, { domainErrorAdapter }), {
    exitCode: 7,
    stdout: "",
    stderr: "EXAMPLE_UNAVAILABLE: example is unavailable\n",
    failureKind: "domain",
  });

  const validation = await executeNodeCli(product, ["architecture", "example", "--format=xml"], options);
  assert.equal(validation.status, "failure");
  assert.equal(validation.failureKind, "validation");

  const grammar = await executeNodeCli(product, ["architecture", "example", "--unknown"], options);
  assert.equal(grammar.status, "failure");
  assert.equal(grammar.usageFailure.code, "unknown-option");

  const unbound = await executeNodeCli({ ...product, handlers: {} }, ["architecture", "example"], options);
  assert.equal(unbound.status, "failure");
  assert.equal(unbound.failureKind, "unexpected");

  assert.deepEqual(handlerCalls, ["json"]);
  assert.deepEqual(executorCalls, [], "canonical failures never dispatch to another source");
});

test("delegated executor failures stay with the delegated owner", async () => {
  const { product, delegated, handlerCalls, executorCalls } = composedFixture({ executorThrows: true });
  const execution = await executeNodeCli(product, ["architecture", "zones"], { delegatedSources: [delegated] });
  assert.deepEqual(execution, { status: "failure", failureKind: "handler-error", error: { code: "DELEGATED_FAILED" } });
  assert.equal(executorCalls.length, 1);
  assert.deepEqual(handlerCalls, [], "delegated failures never dispatch to the canonical runtime");
});

test("composed help and discovery resolve structurally without invoking the delegated executor", async () => {
  const { product, delegated, handlerCalls, executorCalls } = composedFixture();
  const options = { delegatedSources: [delegated] };

  const root = await runNodeCli(product, ["--help"], options);
  assert.equal(root.exitCode, 0);
  assert.match(root.stdout, /architecture\tBrowse architecture examples\./);
  assert.match(root.stdout, /auth\tManage sign-in\./);

  const leaf = await executeNodeCli(product, ["auth", "login", "--account", "team", "--help=full"], options);
  assert.equal(leaf.status, "help");
  assert.deepEqual(leaf.request, { kind: "command", commandId: "external.auth.login", mode: "full" });
  assert.match(leaf.projection, /--account <account>/);

  const zones = await executeNodeCli(product, ["architecture", "zones", "-h"], options);
  assert.equal(zones.status, "help");
  assert.deepEqual(
    zones.discovery.commands.map(({ id }) => id),
    ["external.architecture.zones"],
  );

  const json = await runNodeCli(product, ["--help=json"], options);
  assert.deepEqual(
    JSON.parse(json.stdout).commands.map(({ id }) => id),
    ["architecture.example", "external.architecture.zones", "external.auth.login"],
  );

  assert.deepEqual(executorCalls, [], "help/discovery never execute a delegated runtime");
  assert.deepEqual(handlerCalls, []);
});

test("composed argv runtime selects the owner before parsing command grammar", async () => {
  const { product, delegated, executorCalls } = composedFixture();
  const sources = [{ kind: "canonical", id: "fixture", product }, delegated];
  const tree = composeCommandSources(sources);
  const help = projectComposedCommandTree(tree, { name: "fixture" });

  const recording = recordingBackend();
  const delegatedOutcome = await executeComposedArgv(
    { tree, sources },
    { argv: ["architecture", "zones", "--all"], backend: recording.backend, help },
  );
  assert.deepEqual(delegatedOutcome, {
    status: "delegated",
    sourceId: "external",
    commandId: "external.architecture.zones",
    route: ["architecture", "zones"],
    result: { exitCode: 0, stdout: "external.architecture.zones --all\n", stderr: "" },
  });
  assert.equal(
    recording.calls.some(([kind]) => kind === "command"),
    false,
    "delegated routes are never parsed by the canonical grammar backend",
  );

  const canonicalRecording = recordingBackend(() => ({ format: "full" }));
  const canonicalOutcome = await executeComposedArgv(
    { tree, sources },
    { argv: ["architecture", "example"], backend: canonicalRecording.backend, help },
  );
  assert.deepEqual(canonicalOutcome, {
    status: "success",
    commandId: "architecture.example",
    route: ["architecture", "example"],
    result: { rendered: "full example" },
  });
  assert.deepEqual(canonicalRecording.calls.at(-1), ["command", "architecture.example", [], "root-state"]);

  const helpOutcome = await executeComposedArgv(
    { tree, sources },
    { argv: ["architecture", "zones", "--help"], backend: recordingBackend().backend, help },
  );
  assert.equal(helpOutcome.status, "help");

  const missingOwner = await executeComposedArgv(
    { tree, sources: [sources[0]] },
    { argv: ["architecture", "zones"], backend: recordingBackend().backend, help },
  );
  assert.equal(missingOwner.status, "failure");
  assert.equal(missingOwner.failureKind, "unexpected");
  assert.equal(executorCalls.length, 1);
});
