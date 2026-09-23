# cli-canon

`@yohn-jp/cli-canon` is the internal TypeScript CLI framework for yohn-jp products.

The Command Canon defines one typed command declaration and derives handler
input types, routing, usage, progressive text help, and JSON discovery from it.

## M0

```ts
import * as z from "zod";
import {
  bindHandlers,
  compileProduct,
  defineCommands,
  flag,
  option,
  positional,
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
      target: positional(z.string(), { required: false, description: "Optional named target." }),
      out: option("--out", z.string(), { required: true }),
      format: option("--format", z.enum(["full", "json"]), { valueArity: "optional" }),
      json: flag("--json"),
    },
    result: z.object({ writtenFile: z.string() }),
  },
});

const handlers = bindHandlers(commands)({
  "document.render": ({ out }) => ({ writtenFile: out }),
});

const product = compileProduct({ name: "example", commands, handlers });
const result = await runNodeCli(product, [
  "document",
  "render",
  "input.md",
  "--out",
  "out.html",
]);

const fullHelp = await runNodeCli(product, ["document", "render", "--help=full"]);
const jsonHelp = await runNodeCli(product, ["--help=json"]);
```

Commander is private to the Node adapter. Zod schemas are the runtime validation
authority for framework-owned values.

### Grammar boundary

The framework supports nested routes, required and optional positionals, flags,
options with required or optional values, aliases, repeated options,
`--name=value`, product-root options declared with `placement: "anywhere"`,
and a trailing `rawArgs()` field. `required` controls whether an option must be
present; `valueArity` controls whether its value may be omitted. Field and
command descriptions plus command examples appear in full help and discovery.

`--help` renders text help for the selected root, domain, or command route.
`--help=full` adds descriptions and examples, and `--help=json` returns the
same Canon as JSON discovery. Usage and route listings come from the compiled
declarations.

Order-sensitive repeated groups can be declared with `orderedOptionGroups`,
but construction rejects them as `UNSUPPORTED_GRAMMAR` until the Node adapter
can preserve occurrence order. The framework does not flatten such a grammar.

The default `optionLookingValuePolicy: "consume"` preserves Commander behavior:
`--out --json` binds `"--json"` as the value of `--out`. Declaring
`optionLookingValuePolicy: "reject"` fails construction with
`UNSUPPORTED_GRAMMAR`; the adapter does not emulate it with a second parser.
Unknown options and surplus positionals remain rejected.

## Product identity and public schemas

Pass the consuming product's package metadata at composition time. CLI Canon
does not read the filesystem or maintain a second version/bin literal:

```ts
import packageMetadata from "./package.json" with { type: "json" };

const product = compileProduct({
  name: "document-cli",
  packageMetadata,
  commands,
  handlers,
});
```

`projectDiscovery(product)` exposes only the package `name`, `version`, and
optional `bin` fields under `packageMetadata`. `projectProductSchemas(product,
"complete")` projects each field's Zod value schema and the output schema to
JSON Schema. Command presence and cardinality remain in the discovery fields.
Complete projection rejects Zod refinements or other schemas that cannot be
represented fully. Use `"structural-only"` when the JSON Schema describes
structure but cannot claim equivalent validation.

## Certification helpers

`@yohn-jp/cli-canon/testing` exports `certifyScenarios`. A scenario carries its
independent expected result and can be run against the source, built, and packed
lanes. Keep the expectation separate from the production projector being
certified. This subpath is not imported by the root or Node runtime entries.

## Architecture references

- [Canonical architecture reference](docs/architecture/CANON.md) — normative rules for implementation agents and consumers.
- [Architecture design and cross-product analysis](docs/architecture/cli-canon.md) — rationale, source analysis, and migration design.
