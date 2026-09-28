import * as z from "zod";
import {
  bindHandlers,
  compileProduct,
  defineCommands,
  positional,
  projectDiscovery,
  type CommandDefinition,
  type CommandDiscovery,
  type CommandProminence,
  type CompiledCommand,
  type ComposedCommandNode,
  type DelegatedCommandDescriptor,
  type GroupDefinition,
} from "../../src/index.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type Expect<Value extends true> = Value;

const commands = defineCommands({
  run: { route: ["run"], summary: "Run.", input: {}, result: z.object({ ok: z.boolean() }) },
  repair: {
    route: ["repair"],
    summary: "Repair.",
    prominence: "advanced",
    input: { target: positional(z.string()) },
    result: z.object({ ok: z.boolean() }),
  },
  explicit: { route: ["explicit"], summary: "Explicit.", prominence: "primary", input: {}, result: z.object({}) },
});
const product = compileProduct({
  name: "fixture",
  commands,
  handlers: bindHandlers(commands)({
    run: () => ({ ok: true }),
    repair: ({ target }) => ({ ok: target.length > 0 }),
    explicit: () => ({}),
  }),
});

export type ProminenceContracts = [
  Expect<Equal<CommandProminence, "primary" | "advanced">>,
  Expect<Equal<CommandDefinition["prominence"], CommandProminence | undefined>>,
  Expect<Equal<CompiledCommand["prominence"], CommandProminence>>,
  Expect<Equal<CommandDiscovery["prominence"], CommandProminence>>,
  Expect<Equal<ComposedCommandNode["prominence"], CommandProminence>>,
  Expect<Equal<DelegatedCommandDescriptor["prominence"], CommandProminence | undefined>>,
  // Prominence is a command-only presentation property; groups do not declare it.
  Expect<Equal<"prominence" extends keyof GroupDefinition ? true : false, false>>,
];

const resolved: CommandProminence | undefined = product.commands[0]?.prominence;
const discovered: CommandProminence | undefined = projectDiscovery(product).commands[0]?.prominence;
void resolved;
void discovered;

defineCommands({
  // @ts-expect-error prominence is limited to primary and advanced.
  odd: { route: ["odd"], summary: "Odd.", prominence: "specialized", input: {}, result: z.object({}) },
});
// @ts-expect-error consumer taxonomy is not a prominence level.
const deprecated: CommandProminence = "deprecated";
void deprecated;
// @ts-expect-error delegated descriptors accept only primary or advanced prominence.
const hidden: DelegatedCommandDescriptor = { id: "x", route: ["x"], summary: "X.", prominence: "hidden", fields: [] };
void hidden;
