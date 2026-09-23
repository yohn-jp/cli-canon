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

## Architecture references

- [Canonical architecture reference](docs/architecture/CANON.md) — normative rules for implementation agents and consumers.
- [Architecture design and cross-product analysis](docs/architecture/cli-canon.md) — rationale, source analysis, and migration design.
