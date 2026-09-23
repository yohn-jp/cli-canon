<p align="center">
  <a href="https://github.com/yohn-jp/cli-canon/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/yohn-jp/cli-canon/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://www.npmjs.com/package/@yohn-jp/cli-canon"><img alt="npm" src="https://img.shields.io/npm/v/@yohn-jp/cli-canon"></a>
  <a href="https://www.npmjs.com/package/@yohn-jp/cli-canon"><img alt="Node" src="https://img.shields.io/node/v/@yohn-jp/cli-canon"></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/npm/l/@yohn-jp/cli-canon"></a>
</p>

# CLI Canon

**Canonical TypeScript CLI contracts for yohn-jp products**

`@yohn-jp/cli-canon` is the shared CLI foundation used to define a product command surface once and derive typed handlers, routing, help, discovery, invocation metadata, Skill projections, Path Canon, output behavior, and package certification from the same authority.

It is intentionally not a general-purpose CLI framework. Product-domain authorization, lifecycle/state-machine decisions, provider behavior, filesystem safety, transport authority, and domain schemas remain owned by each consumer.

## Install

Requires Node.js 24 or newer and Zod 4.

```bash
npm install @yohn-jp/cli-canon zod
```

The package is a library and does not install a standalone CLI binary.

## Quick start

```ts
import * as z from "zod";
import {
  bindHandlers,
  compileProduct,
  defineCommands,
  flag,
  option,
  positional,
  projectInvocation,
} from "@yohn-jp/cli-canon";
import { runNodeCli } from "@yohn-jp/cli-canon/node";

const commands = defineCommands({
  "document.render": {
    route: ["document", "render"],
    summary: "Render a document.",
    description: "Render a document to the selected output path.",
    examples: ["example document render input.md --out=out.html"],
    input: {
      file: positional(z.string(), { description: "Input document." }),
      target: positional(z.string(), {
        required: false,
        description: "Optional named target.",
      }),
      out: option("--out", z.string(), {
        aliases: ["-o"],
        required: true,
      }),
      format: option("--format", z.enum(["full", "json"]), {
        valueArity: "optional",
      }),
      json: flag("--json"),
    },
    result: z.object({ writtenFile: z.string() }),
  },
});

const handlers = bindHandlers(commands)({
  "document.render": ({ out }) => ({ writtenFile: out }),
});

const product = compileProduct({
  name: "example",
  commands,
  handlers,
  schemaProjectionCompleteness: "complete",
});

const result = await runNodeCli(product, [
  "document",
  "render",
  "input.md",
  "--out",
  "out.html",
]);

const invocation = projectInvocation(product, "document.render", {
  file: "input.md",
  out: "out.html",
  json: true,
});

if (invocation.state === "ready") {
  console.log(invocation.value);
  // { executable: "example", argv: ["document", "render", ...] }
}
```

## One authority, multiple projections

```text
typed authoring declarations
          |
     compileProduct
          |
   CompiledProduct
    /   |    |    \
runtime help Skill discovery
          |
 invocation / Path / fixtures
```

A CLI fact is authored once. Routing, usage, progressive help, JSON discovery, Skill command metadata, and invocation argv are derived rather than maintained as parallel tables.

## Package surfaces

| Import | Purpose |
| --- | --- |
| `@yohn-jp/cli-canon` | Authoring, compiler, projections, Path/Skill/Output Canon |
| `@yohn-jp/cli-canon/node` | Node.js / Commander runtime adapter |
| `@yohn-jp/cli-canon/testing` | Reusable source/built/packed certification primitives |

The root import is side-effect free. Commander is private to the Node adapter.

## Command and grammar contract

CLI Canon supports:

- nested command routes;
- required and optional positionals;
- flags and required/optional-value options;
- aliases and repeatable options;
- `--name=value`;
- options declared with `placement: "anywhere"`;
- trailing `rawArgs()`;
- progressive root/domain/leaf help;
- `--help=full` and `--help=json`;
- deterministic JSON discovery.

Unsupported grammar fails closed rather than falling back to a second parser.

Current explicit limits:

- `orderedOptionGroups` are rejected as `UNSUPPORTED_GRAMMAR`;
- `optionLookingValuePolicy: "reject"` is rejected as `UNSUPPORTED_GRAMMAR`.

The default option-looking-value behavior remains Commander's consume semantics.

## Invocation Canon

Executable invocation is a structured value, not a shell string:

```ts
{ executable: string, argv: string[] }
```

`projectInvocation(product, commandId, bindings)` derives argv from Command Canon. Missing required bindings produce a `requires-input` projection and do not expose executable argv.

Skill command bindings use the same projection through `skillCommand(...)`; usage text is display-only and is never reparsed for execution.

## Help, discovery, and public schemas

Text help and JSON discovery derive from the same compiled command graph.

Pass package metadata at composition time when package identity should be projected:

```ts
import packageMetadata from "./package.json" with { type: "json" };

const product = compileProduct({
  name: "document-cli",
  packageMetadata,
  schemaProjectionCompleteness: "complete",
  commands,
  handlers,
});
```

`projectProductSchemas(product, "complete")` projects framework-owned value contracts to JSON Schema. Unsupported complete projections fail explicitly. Use `"structural-only"` when a schema cannot claim equivalent complete validation.

## Output contract

CLI Canon keeps exit status, stream, bytes, and failure classification together.

Machine JSON:

- is complete or fails;
- is never byte-truncated;
- counts UTF-8 bytes including the final newline;
- rejects non-finite numbers and unsupported JSON values instead of silently converting or omitting them.

Products may supply a typed domain-error adapter without moving domain error semantics into CLI Canon.

## Skill Canon

Skills are intent-oriented projections over Command Canon and product-owned results. They may contain prose, command references, delegation, invariants, and opaque domain-result references.

Public Skill projections reject unknown commands, private commands, unknown delegated Skills, and delegation cycles at construction.

Skill text and JSON use the shared output policy. The default budget is 4096 UTF-8 bytes; over-budget output fails explicitly and is never truncated.

## Path Canon

Path Canon models addresses, not permissions.

It supports derived Path IDs, parameters, file/directory kinds, parent references, explicit cwd/home/env/platform context, and ordered root strategies. Resolution is lexical and side-effect free; it does not create files, resolve authorization, or grant filesystem ownership.

## Certification

`@yohn-jp/cli-canon/testing` provides reusable certification scenarios with:

- stable scenario identity;
- target command identity;
- explicit input;
- independent expected output;
- required source/built/packed lanes;
- optional setup.

The repository package gate builds one tarball, installs that exact artifact into an isolated consumer, and verifies exports, public types, root-import purity, and runtime behavior.

The current architecture-conformance baseline is recorded in [`test/architecture-conformance.md`](./test/architecture-conformance.md).

## Architecture

The README is an entry point, not a second architecture authority.

| Authority | Scope |
| --- | --- |
| [Canonical architecture](./docs/architecture/CANON.md) | Normative ownership, boundaries, and implementation rules |
| [Architecture design](./docs/architecture/cli-canon.md) | Cross-product rationale, admission corpus, and migration design |

## Releases

Release notes live under [`docs/releases/`](./docs/releases/).

- [0.1.0](./docs/releases/0.1.0.md) — initial public package release.
- [Releasing CLI Canon](./docs/releases/RELEASING.md) — bootstrap manual publish and subsequent OIDC release workflow.

## Development

```bash
pnpm install --frozen-lockfile
pnpm run verify
```

`pnpm run verify` is the authoritative local verification entry point.

## License

MIT — see [LICENSE](./LICENSE).
