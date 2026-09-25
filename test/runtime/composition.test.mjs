import assert from "node:assert/strict";
import test from "node:test";
import * as z from "zod";
import {
  CanonConstructionError,
  bindHandlers,
  compileProduct,
  composeCommandSources,
  defineCommands,
  defineGroups,
  option,
  positional,
} from "../../dist/index.js";

function canonicalProduct(calls = []) {
  const commands = defineCommands({
    "document.render": {
      route: ["document", "render"],
      summary: "Render a document.",
      input: { file: positional(z.string()), out: option("--out", z.string(), { aliases: ["-o"] }) },
      result: z.object({ ok: z.boolean() }),
    },
    "status.show": {
      route: ["status"],
      summary: "Show status.",
      visibility: "private",
      input: {},
      result: z.object({ ok: z.boolean() }),
    },
  });
  const groups = defineGroups({
    document: { route: ["document"], summary: "Work with documents.", examples: ["cli document render a.md"] },
  });
  const handlers = bindHandlers(commands)({
    "document.render": () => {
      calls.push("document.render");
      return { ok: true };
    },
    "status.show": () => {
      calls.push("status.show");
      return { ok: true };
    },
  });
  return compileProduct({ name: "cli", commands, groups, handlers });
}

function delegatedSource(calls = [], overrides = {}) {
  return {
    kind: "delegated",
    id: "external",
    commands: [
      {
        id: "external.document.convert",
        route: ["document", "convert"],
        summary: "Convert a document.",
        fields: [{ key: "file", kind: "positional", required: true }],
      },
      { id: "external.sync", route: ["sync"], summary: "Synchronize.", fields: [] },
    ],
    // Not part of the structural contract; composition must never call it.
    execute: () => {
      calls.push("execute");
    },
    ...overrides,
  };
}

function issueCodes(fn) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof CanonConstructionError);
    return error.issues.map((issue) => ({
      code: issue.code,
      sourceId: issue.sourceId,
      commandId: issue.commandId,
      groupId: issue.groupId,
    }));
  }
  assert.fail("expected CanonConstructionError");
}

function shape(nodes) {
  return nodes.map((node) =>
    node.kind === "group"
      ? { kind: node.kind, id: node.id, owner: node.owner.sourceId, children: shape(node.children) }
      : { kind: node.kind, id: node.id, owner: node.owner.sourceId },
  );
}

test("canonical-only source composes the canonical tree with Canon ownership", () => {
  const calls = [];
  const composed = composeCommandSources([{ kind: "canonical", id: "canon", product: canonicalProduct(calls) }]);
  assert.deepEqual(composed.sources, [{ kind: "canonical", sourceId: "canon" }]);
  assert.deepEqual(shape(composed.root.children), [
    {
      kind: "group",
      id: "document",
      owner: "canon",
      children: [{ kind: "command", id: "document.render", owner: "canon" }],
    },
    { kind: "command", id: "status.show", owner: "canon" },
  ]);
  const [group, status] = composed.root.children;
  assert.equal(group.kind, "group");
  assert.deepEqual(group.route, ["document"]);
  assert.equal(group.visibility, "public");
  assert.deepEqual(group.examples, ["cli document render a.md"]);
  const render = group.children[0];
  assert.deepEqual(render.owner, { kind: "canonical", sourceId: "canon" });
  assert.deepEqual(
    render.fields.map((field) => field.key),
    ["file", "out"],
  );
  assert.equal(status.visibility, "private");
  assert.ok(Object.isFrozen(composed) && Object.isFrozen(composed.root) && Object.isFrozen(render.fields));
  assert.ok(Object.isFrozen(render.route) && Object.isFrozen(render.fields[1].aliases));
  assert.deepEqual(calls, []);
});

test("canonical and delegated siblings share one group without ambiguous leaf ownership", () => {
  const calls = [];
  const composed = composeCommandSources([
    { kind: "canonical", id: "canon", product: canonicalProduct(calls) },
    delegatedSource(calls),
  ]);
  assert.deepEqual(composed.sources, [
    { kind: "canonical", sourceId: "canon" },
    { kind: "delegated", sourceId: "external" },
  ]);
  assert.deepEqual(shape(composed.root.children), [
    {
      kind: "group",
      id: "document",
      owner: "canon",
      children: [
        { kind: "command", id: "external.document.convert", owner: "external" },
        { kind: "command", id: "document.render", owner: "canon" },
      ],
    },
    { kind: "command", id: "status.show", owner: "canon" },
    { kind: "command", id: "external.sync", owner: "external" },
  ]);
  const convert = composed.root.children[0].children[0];
  assert.deepEqual(convert.owner, { kind: "delegated", sourceId: "external" });
  assert.equal(convert.visibility, "public");
  assert.deepEqual(convert.fields, [{ key: "file", kind: "positional", required: true }]);
  assert.deepEqual(calls, [], "composition must not invoke handlers or delegated executors");
});

test("delegated sources may declare groups whose children come from other sources", () => {
  const composed = composeCommandSources([
    delegatedSource([], {
      groups: [{ id: "external.tools", route: ["tools"], summary: "Tools.", visibility: "private" }],
      commands: [{ id: "external.tools.fetch", route: ["tools", "fetch"], summary: "Fetch.", fields: [] }],
    }),
    {
      kind: "delegated",
      id: "other",
      commands: [{ id: "other.tools.push", route: ["tools", "push"], summary: "Push.", fields: [] }],
    },
  ]);
  assert.deepEqual(shape(composed.root.children), [
    {
      kind: "group",
      id: "external.tools",
      owner: "external",
      children: [
        { kind: "command", id: "external.tools.fetch", owner: "external" },
        { kind: "command", id: "other.tools.push", owner: "other" },
      ],
    },
  ]);
  assert.equal(composed.root.children[0].visibility, "private");
});

test("duplicate route ownership fails at construction", () => {
  const product = canonicalProduct();
  assert.deepEqual(
    issueCodes(() =>
      composeCommandSources([
        { kind: "canonical", id: "canon", product },
        delegatedSource([], {
          commands: [{ id: "external.render", route: ["document", "render"], summary: "Render.", fields: [] }],
        }),
      ]),
    ),
    [{ code: "DUPLICATE_ROUTE", sourceId: "external", commandId: "external.render", groupId: undefined }],
  );
  assert.deepEqual(
    issueCodes(() =>
      composeCommandSources([
        { kind: "canonical", id: "canon", product },
        delegatedSource([], {
          groups: [{ id: "external.document", route: ["document"], summary: "Documents." }],
          commands: [],
        }),
      ]),
    ),
    [{ code: "DUPLICATE_ROUTE", sourceId: "external", commandId: undefined, groupId: "external.document" }],
  );
  assert.deepEqual(
    issueCodes(() =>
      composeCommandSources([
        { kind: "canonical", id: "canon", product },
        delegatedSource([], {
          commands: [{ id: "status.show", route: ["other"], summary: "Other.", fields: [] }],
        }),
      ]),
    ),
    // Conflicts are attributed in canonical route order: ["other"] precedes ["status"].
    [{ code: "DUPLICATE_COMMAND_ID", sourceId: "canon", commandId: "status.show", groupId: undefined }],
  );
  assert.deepEqual(
    issueCodes(() =>
      composeCommandSources([
        { kind: "canonical", id: "canon", product },
        { kind: "canonical", id: "canon", product },
      ]),
    ),
    [{ code: "DUPLICATE_COMMAND_SOURCE", sourceId: "canon", commandId: undefined, groupId: undefined }],
  );
});

test("parent/child structural conflicts fail at construction", () => {
  const product = canonicalProduct();
  // A delegated command cannot claim a canonical group route.
  assert.deepEqual(
    issueCodes(() =>
      composeCommandSources([
        { kind: "canonical", id: "canon", product },
        delegatedSource([], {
          commands: [{ id: "external.document", route: ["document"], summary: "Document.", fields: [] }],
        }),
      ]),
    ),
    [{ code: "AMBIGUOUS_ROUTE_OWNERSHIP", sourceId: "external", commandId: "external.document", groupId: undefined }],
  );
  // A delegated route cannot nest under a canonical command leaf.
  assert.deepEqual(
    issueCodes(() =>
      composeCommandSources([
        { kind: "canonical", id: "canon", product },
        delegatedSource([], {
          commands: [{ id: "external.status.more", route: ["status", "more"], summary: "More.", fields: [] }],
        }),
      ]),
    ),
    [{ code: "INVALID_PARENT", sourceId: "external", commandId: "external.status.more", groupId: undefined }],
  );
  // A delegated group cannot nest under a canonical command leaf either.
  assert.deepEqual(
    issueCodes(() =>
      composeCommandSources([
        { kind: "canonical", id: "canon", product },
        delegatedSource([], {
          groups: [{ id: "external.status.tools", route: ["status", "tools"], summary: "Tools." }],
          commands: [],
        }),
      ]),
    ),
    [{ code: "INVALID_PARENT", sourceId: "external", commandId: undefined, groupId: "external.status.tools" }],
  );
});

test("invalid source declarations fail closed", () => {
  const codes = issueCodes(() =>
    composeCommandSources([
      { kind: "plugin", id: "unknown" },
      { kind: "delegated", id: "", commands: [] },
      { kind: "canonical", id: "broken", product: {} },
      {
        kind: "delegated",
        id: "bad",
        groups: [{ id: "bad.group", route: ["g"], summary: "G.", fields: [] }],
        commands: [
          { id: "bad.route", route: ["two words"], summary: "Bad.", fields: [] },
          { id: "bad.fields", route: ["ok"], summary: "Bad.", fields: [{ key: "x", kind: "mystery" }] },
        ],
      },
    ]),
  );
  assert.deepEqual(
    codes.map(({ code, sourceId }) => `${code}:${sourceId}`),
    [
      "INVALID_COMMAND_SOURCE:unknown",
      "INVALID_COMMAND_SOURCE:undefined",
      "INVALID_GROUP_DECLARATION:bad",
      "INVALID_ROUTE:bad",
      "INVALID_COMMAND_SOURCE:bad",
      "INVALID_COMMAND_SOURCE:broken",
    ],
  );
  assert.throws(() => composeCommandSources("nope"), CanonConstructionError);
});

test("composition is deterministic regardless of source and descriptor order", () => {
  const product = canonicalProduct();
  const forward = composeCommandSources([
    { kind: "canonical", id: "canon", product },
    delegatedSource(),
    { kind: "delegated", id: "alpha", commands: [{ id: "alpha.a", route: ["a"], summary: "A.", fields: [] }] },
  ]);
  const reversedDelegated = delegatedSource();
  const reversed = composeCommandSources([
    { kind: "delegated", id: "alpha", commands: [{ id: "alpha.a", route: ["a"], summary: "A.", fields: [] }] },
    { ...reversedDelegated, commands: [...reversedDelegated.commands].reverse() },
    { kind: "canonical", id: "canon", product },
  ]);
  assert.deepEqual(reversed, forward);
  assert.deepEqual(
    forward.sources.map((source) => source.sourceId),
    ["alpha", "canon", "external"],
  );
  assert.deepEqual(
    forward.root.children.map((node) => node.route.join(" ")),
    ["a", "document", "status", "sync"],
  );

  const conflicting = (order) =>
    issueCodes(() =>
      composeCommandSources(
        order.map((id) => ({
          kind: "delegated",
          id,
          commands: [{ id: `${id}.x`, route: ["x"], summary: "X.", fields: [] }],
        })),
      ),
    );
  assert.deepEqual(conflicting(["b", "a", "c"]), conflicting(["c", "b", "a"]));
  assert.deepEqual(
    conflicting(["c", "b", "a"]).map((issue) => issue.sourceId),
    ["b", "c"],
  );
});
