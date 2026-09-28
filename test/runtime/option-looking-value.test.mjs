import assert from "node:assert/strict";
import test from "node:test";
import * as z from "zod";
import { bindHandlers, compileProduct, defineCommands, flag, option, positional } from "../../dist/index.js";
import { executeNodeCli, runNodeCli } from "../../dist/node/index.js";

function fixture() {
  const commands = defineCommands({
    "repo.show": {
      route: ["repo", "show"],
      summary: "Show a repository.",
      input: {
        target: positional(z.string(), { required: false, metavar: "target" }),
        repository: option("--repository", z.string(), {
          aliases: ["-R"],
          required: true,
          optionLookingValuePolicy: "reject",
        }),
        label: option("--label", z.string(), { optionLookingValuePolicy: "consume" }),
        note: option("--note", z.string()),
        draft: flag("--draft"),
        scope: option("--scope", z.string(), { placement: "anywhere", optionLookingValuePolicy: "reject" }),
        verbose: flag("--verbose", { placement: "anywhere" }),
      },
      result: z.object({
        target: z.string().optional(),
        repository: z.string(),
        label: z.string().optional(),
        note: z.string().optional(),
        draft: z.boolean(),
        scope: z.string().optional(),
      }),
    },
  });
  return compileProduct({
    name: "fixture",
    commands,
    handlers: bindHandlers(commands)({
      "repo.show": ({ target, repository, label, note, draft, scope }) => ({
        ...(target === undefined ? {} : { target }),
        repository,
        ...(label === undefined ? {} : { label }),
        ...(note === undefined ? {} : { note }),
        draft,
        ...(scope === undefined ? {} : { scope }),
      }),
    }),
  });
}

async function success(argv) {
  const result = await runNodeCli(fixture(), argv);
  assert.equal(result.exitCode, 0, `${argv.join(" ")}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

test("reject never binds a following option-looking token as a command-scoped required value", async () => {
  const commandUsage = (await executeNodeCli(fixture(), ["repo", "show", "--repository"])).usage;
  assert.ok(commandUsage.includes("-R, --repository <repository>"));
  for (const [argv, option] of [
    [["repo", "show", "--repository", "--draft"], "--repository"],
    [["repo", "show", "-R", "--draft"], "-R"],
    [["repo", "show", "--repository", "--unknown"], "--repository"],
    [["repo", "show", "--repository", "-x", "target"], "--repository"],
    [["repo", "show", "--repository", "acme", "--scope", "--verbose"], "--scope"],
  ]) {
    const execution = await executeNodeCli(fixture(), argv);
    assert.equal(execution.status, "failure", argv.join(" "));
    assert.equal(execution.failureKind, "usage", argv.join(" "));
    assert.deepEqual(execution.usageFailure, { code: "missing-option-value", commandId: "repo.show", option });
    assert.deepEqual(execution.usage, commandUsage);

    const result = await runNodeCli(fixture(), argv);
    assert.equal(result.exitCode, 2);
    assert.equal(result.failureKind, "usage");
    assert.equal(result.stdout, "");
  }
});

test("reject leaves a missing value at the end of argv to the existing structured failure", async () => {
  const execution = await executeNodeCli(fixture(), ["repo", "show", "--repository"]);
  assert.equal(execution.status, "failure");
  assert.equal(execution.failureKind, "usage");
  assert.equal(execution.usageFailure.code, "missing-option-value");
  assert.equal(execution.usageFailure.commandId, "repo.show");
});

test("reject applies to root-scoped anywhere options before the route", async () => {
  const execution = await executeNodeCli(fixture(), ["--scope", "--verbose", "repo", "show", "--repository", "acme"]);
  assert.equal(execution.status, "failure");
  assert.equal(execution.failureKind, "usage");
  assert.deepEqual(execution.usageFailure, { code: "missing-option-value", option: "--scope" });

  assert.deepEqual(await success(["--scope", "team", "repo", "show", "--repository", "acme"]), {
    repository: "acme",
    draft: false,
    scope: "team",
  });
});

test("standard shell tokens following a missing reject-policy value keep their precedence", async () => {
  const help = await executeNodeCli(fixture(), ["repo", "show", "--repository", "--help"]);
  assert.equal(help.status, "help");
  assert.deepEqual(help.request, { kind: "command", commandId: "repo.show", mode: "text" });
  const rootHelp = await executeNodeCli(fixture(), ["--scope", "--help"]);
  assert.equal(rootHelp.status, "help");
  assert.equal(rootHelp.request.kind, "root");

  for (const argv of [
    ["repo", "show", "--repository", "--json"],
    ["repo", "show", "--repository", "--json", "target"],
    ["repo", "show", "--json", "--repository", "--json", "target"],
  ]) {
    const execution = await executeNodeCli(fixture(), argv);
    assert.equal(execution.status, "failure", argv.join(" "));
    assert.equal(execution.presentation, "machine");
    assert.equal(execution.failureKind, "usage");
    assert.equal(execution.usageFailure.code, "missing-option-value");
    assert.equal(execution.usageFailure.commandId, "repo.show");

    const result = await runNodeCli(fixture(), argv);
    assert.equal(result.exitCode, 2);
    const document = JSON.parse(result.stderr);
    assert.equal(document.error.kind, "usage");
    assert.equal(document.error.code, "missing-option-value");
    assert.equal(document.error.commandId, "repo.show");
  }

  const rootJson = await executeNodeCli(fixture(), ["--scope", "--json", "repo", "show", "--repository", "acme"]);
  assert.equal(rootJson.status, "failure");
  assert.equal(rootJson.presentation, "machine");
  assert.deepEqual(rootJson.usageFailure, { code: "missing-option-value", option: "--scope" });
});

test("attached reject-policy values are explicit values", async () => {
  assert.deepEqual(await success(["repo", "show", "--repository=--draft"]), { repository: "--draft", draft: false });
  assert.deepEqual(await success(["repo", "show", "--repository=--help"]), { repository: "--help", draft: false });
  assert.deepEqual(await success(["repo", "show", "--repository=--json"]), { repository: "--json", draft: false });
  assert.deepEqual(await success(["--scope=--verbose", "repo", "show", "--repository", "acme"]), {
    repository: "acme",
    draft: false,
    scope: "--verbose",
  });
});

test("reject keeps the negative-number lexical exception", async () => {
  assert.deepEqual(await success(["repo", "show", "--repository", "-1"]), { repository: "-1", draft: false });
  assert.deepEqual(await success(["repo", "show", "-R", "-1x", "--draft"]), { repository: "-1x", draft: true });
});

test("reject accepts ordinary values and consume keeps binding option-looking values", async () => {
  assert.deepEqual(await success(["repo", "show", "target", "--repository", "acme", "--draft"]), {
    target: "target",
    repository: "acme",
    draft: true,
  });
  assert.deepEqual(await success(["repo", "show", "--repository", "acme", "--label", "--draft"]), {
    repository: "acme",
    label: "--draft",
    draft: false,
  });
  assert.deepEqual(await success(["repo", "show", "--repository", "acme", "--note", "--json"]), {
    repository: "acme",
    note: "--json",
    draft: false,
  });
  assert.deepEqual(await success(["repo", "show", "--label", "--repository", "--repository", "acme"]), {
    repository: "acme",
    label: "--repository",
    draft: false,
  });
  const helpAsValue = await executeNodeCli(fixture(), ["repo", "show", "--repository", "acme", "--label", "--help"]);
  assert.equal(helpAsValue.status, "success");
  assert.equal(helpAsValue.presentation, "human");
  assert.equal(helpAsValue.result.label, "--help");
});
