# cli-canon

`@yohn-jp/cli-canon` is the internal TypeScript CLI framework for yohn-jp products.

The M0 contract defines one typed Command Canon and derives handler input types,
routing, text help, and machine-readable discovery from that declaration.

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
    input: {
      file: positional(z.string()),
      out: option("--out", z.string(), { required: true }),
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
```

Commander is private to the Node adapter. Zod schemas are the runtime validation
authority for framework-owned values.

### M0 grammar boundary

M0 supports nested routes, required positionals, flags, required/optional value
options, aliases, repeated options, `--name=value`, product-root options
declared with `placement: "anywhere"`, and a trailing `rawArgs()` field.

Ordered option groups such as Nawabari's repeated
`--resource <path> --mode <mode>` pairs are deliberately **not admitted in
M0**. The framework does not flatten such a grammar and does not claim it is
supported yet.

Commander semantics are retained for an option-looking token used as the value
of a required option: `--out --json` binds `"--json"` as the value of
`--out`. Products such as Mottainai that intentionally reject that form need
an explicit later grammar primitive; M0 does not silently emulate it with a
second parser.

## Architecture references

- [Canonical architecture reference](docs/architecture/CANON.md) — normative rules for implementation agents and consumers.
- [Architecture design and cross-product analysis](docs/architecture/cli-canon.md) — rationale, source analysis, and migration design.
