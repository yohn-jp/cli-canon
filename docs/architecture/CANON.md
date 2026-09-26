# CLI Canon — Canonical Architecture Reference

Status: **Normative**
Package: `@yohn-jp/cli-canon`
Consumers: Inari, Nawabari, Wabachi, Suzukuri, Mottainai

This document is the canonical architecture reference for implementation agents working on CLI Canon and its consumers.

The longer rationale and cross-product analysis lives in [cli-canon.md](./cli-canon.md). This document defines the rules that implementations must preserve.

## 1. Authority

For implementation work, use this order:

1. The accepted Implementation Issue defines the requested scope and acceptance criteria.
2. This document defines CLI Canon architecture and ownership boundaries.
3. Existing public contracts of CLI Canon itself define behavior that must be preserved.
4. Existing implementation, including consumer compatibility fixtures, is evidence, not authority when it conflicts with the above.

Canon is normative for the standard CLI shell (§11.2). A consumer compatibility fixture records what a product did before migration. It is evidence for classifying that behavior in the migration ledger (§17.1); it is never automatically the target output. A legacy behavior remains a preservation requirement only when the ledger classifies it `preserve-domain` or `special-surface`.

An Implementation Issue may narrow the work. It must not silently weaken or replace this architecture. A change to these rules is an explicit architecture change and must update this document.

## 2. Core principle

**A fact has one authoring authority. Everything else references or projects it.**

CLI Canon exists to eliminate independently maintained copies of the same CLI fact.

Do not maintain a command route in one table, its options in another table, its help in a string, and its Skill invocation somewhere else.

The intended direction is:

```text
typed authoring declaration
          |
     compileProduct
          |
   CompiledProduct
    /     |      \
 runtime help   discovery
          |
     later projections
   Skill / Path / fixtures
```

When two surfaces can be derived from the same fact, they must be derived rather than manually synchronized.

## 3. Product boundary

CLI Canon owns CLI-product structure.

CLI Canon may own:

- command identity
- command route
- positional and option syntax
- CLI input schemas
- handler binding
- result boundary validation
- routing
- text help
- machine-readable discovery
- shared output contracts
- Skill references and projections
- path-address declarations and projections
- generic CLI fixture/package certification primitives

CLI Canon does **not** own product domain semantics.

The consumer product continues to own:

- authorization and permissions
- lifecycle/state-machine decisions
- Git/worktree/claim semantics
- filesystem safety and ownership
- provider/API behavior
- transport-specific authority
- product-specific domain schemas
- product-specific error decisions
- retries and idempotency policy unless explicitly part of a shared CLI transport contract

The framework binds CLI input to product handlers. It does not become the domain.

## 4. The three models

Keep these representations separate.

### 4.1 Authoring Model

The human-edited, typed declaration.

It contains the minimum facts needed to describe the CLI product surface.

Properties:

- literal identities are preserved
- IDs are inferred from declarations
- Zod schemas are runtime validation authorities for framework-owned input/result values
- references use typed IDs or handles instead of copied strings
- no handwritten union duplicates identities already present in declarations

### 4.2 CompiledProduct

The validated runtime model produced by the compiler.

Compilation validates relationships that TypeScript alone cannot prove, including collisions and unsupported grammar.

Properties:

- immutable public representation
- no Commander objects in the public model
- no mutable parser state in the public model
- no hidden execution on construction
- invalid declarations fail before command execution
- projections consume this model instead of re-reading unrelated authoring data

### 4.3 Public projection

A transport-safe representation such as help or JSON discovery.

Properties:

- contains no handlers, closures, secrets, Zod instances, Commander instances, or internal state-machine snapshots
- is a projection, never a new authority
- is not loaded back as executable configuration
- preserves stable IDs needed by consumers

## 5. Type system rules

### 5.1 Identities are derived

This is canonical:

```ts
const commands = defineCommands({
  "document.render": {/* ... */},
});

type CommandId = keyof typeof commands;
```

This is not:

```ts
type CommandId = "document.render" | "document.validate";

const commands = {/* second authority */};
```

The same rule applies to future Path IDs, Skill IDs, capability IDs, and other registries.

### 5.2 Handler types come from declarations

Handlers must receive input inferred from the command declaration.

Do not duplicate the shape in an interface.

Do not use `any`, broad `Record<string, unknown>` public handler types, or `as` casts to recover the desired type.

A command result schema also participates in the handler contract and runtime output boundary.

### 5.3 Type safety is not the only safety layer

Use the appropriate layer for each invariant:

- TypeScript: known IDs, handler shape, input/result inference
- compiler: collisions, reference validity, grammar admissibility
- runtime decoder: untrusted argv values
- domain: authorization and semantic validity
- compatibility fixture: preservation of external behavior classified `preserve-domain` or `special-surface` (§17.1)

Do not claim a runtime/domain invariant is proven merely because a TypeScript type exists.

## 6. Command Canon

The command declaration is the authority for:

- stable command ID
- route
- summary
- input fields
- field syntax
- result schema
- handler type

Routing, parser configuration, usage, help, discovery, and later Skill invocation metadata must derive from this model.

There must not be a second framework-owned dispatcher such as:

```ts
if (command === "foo") ...
if (command === "bar") ...
```

when the same command set already exists in Canon.

### 6.1 Route groups and command tree

CLI structure has one explicit vocabulary of node kinds: `root`, `group`, and `command`.

- `root` is the product itself. It has no route and is not executable.
- `group` is a non-executable route group declared with `defineGroups`. A `GroupDefinition` carries a route, a summary, and optional description, examples, and visibility. It declares no input, result, or handler.
- `command` is an executable leaf that references exactly one `CommandDefinition` by its command ID.

Group IDs are inferred from the `defineGroups` declaration keys, as command IDs are from `defineCommands`. Groups are first-class declarations rather than projection-time inference from shared route prefixes. Command grammar is still authored once in `CommandDefinition`; tree nodes reference command declarations and never copy them into a second command model. No projection-specific tree becomes an authority.

Authority boundary: the consumer product owns product/domain content, including the product description plus group and command IDs, route tokens, summaries, descriptions, and examples. CLI Canon owns the standard CLI structure vocabulary, the runtime, and presentation derived from it. Product and group metadata are generic presentation content, not product logic.

### 6.2 Canonical help document

Help has one semantic authority: the help document projected by `projectHelpDocument` from the resolved command tree and compiled command fields. Text help and JSON help consume this document; neither rebuilds route structure nor carries independent route or flag authority. Canonical-only products use their compiled tree; products with delegated sources use the result of `composeCommandSources` through `projectComposedCommandTree`. The projection reads the resolved tree and never executes a source.

- A help target is explicit: `root`, a declared `group`, or a `command`. An undeclared shared route prefix is not a target and has no inferred summary; commands under it are listed from their nearest declared ancestor with their remaining route segments.
- The document carries the resolved target, derived usage tokens, target summary/description, arguments, options, children, examples, and the command leaves of the target subtree. The optional product description is the root target summary and therefore appears in standard root help while remaining consumer-authored content.
- Usage is derived from the route and declared field grammar; it is never a maintained string.
- Group content comes from the group declaration, never from a descendant command.
- `summary` (`--help`) contains usage, target summary, and child summaries. `full` (`--help=full`) adds target description, arguments, options, child descriptions, and examples. `json` (`--help=json`) is the discovery projection of the same document's command leaves.
- `LegacyRouteDescriptor`, `composeCommandProjection`, and the Node `legacyRoutes` option are deprecated compatibility APIs for 0.1.7 consumers. Migrate each route to a `DelegatedCommandSource`, compose it with the canonical source using `composeCommandSources`, and pass the executable source through Node's `delegatedSources`. Use `projectComposedCommandTree` when projecting help directly. This keeps route ownership, group membership, help, and discovery on the resolved tree without consumer-side route extraction or help splicing.

## 7. Input Canon

CLI syntax and value semantics are related but distinct.

The field declaration owns:

- positional vs option vs flag vs raw argv
- flags and aliases
- required/optional presence
- repeatability
- CLI placement rules
- display metadata such as metavar

Zod owns validation of a value after the syntax layer has identified it.

Do not encode the same presence/default rule independently in both layers.

For existing consumer domain schemas, do not rewrite them into CLI Canon merely for uniformity. Decode the CLI envelope, then call the existing domain authority.

## 8. Runtime and parser boundary

Commander is a private Node adapter implementation detail.

Consumers must not depend on Commander objects, Commander option keys, or Commander mutation APIs.

Each invocation constructs isolated parser state.

The root package import must not:

- read `process.argv`
- call `process.exit()`
- print to stdout/stderr
- install signal handlers
- touch the filesystem
- start a server
- access the network

The Node adapter returns an explicit outcome to the product composition root.

## 9. Grammar admission

CLI Canon must not claim syntax it cannot preserve.

Supported grammar is explicit and tested.

If a product grammar cannot be represented correctly by the current backend, reject the declaration or leave the product command unmigrated.

Do not:

- introduce a hidden second parser
- silently change argv meaning
- accept unknown options as a compatibility escape hatch
- flatten order-sensitive occurrences when order has semantic meaning
- change product behavior merely to fit Commander defaults

M0 deliberately does not admit Nawabari-style ordered repeated option groups such as:

```text
--resource a --mode write --resource b --mode read
```

M0 also retains Commander required-value behavior in which an option-looking token may be consumed as the required value. Products with a different established contract require an explicit later grammar primitive before migration.

## 10. Projection rule

A projection must not become a second source.

Examples:

- help route derives from command route
- help options derive from command fields
- JSON discovery derives from CompiledProduct
- Skill command references use Command IDs
- generated Skill commands derive argv from command definitions
- package fixtures refer to canonical command IDs

If a generated value is needed at runtime, regenerate or project it from Canon. Do not copy the generated text into another maintained table.

## 11. Output rule

The common output contract must distinguish:

- success
- usage failure
- input validation failure
- handler-result validation failure
- unexpected framework failure
- product/domain failure when the consumer maps one

An output operation owns exit code, stdout, stderr, and failure classification together.

Machine-readable output must remain structurally valid. Never truncate JSON bytes to meet a budget.

Do not silently convert a failed projection into exit code 0.

### 11.1 Presentation ownership

CLI Canon owns the standard shell (§11.2): root no-args, Help, version, the machine presentation selector, and the human and machine projections of usage failures, validation failures, handler-result failures, and unexpected framework failures. A product may present a typed command result through `NodeCliResultPresenter` and map typed domain errors through `DomainErrorAdapter`.

The two ownerships are distinct:

| Concern                                                                              | Owner                             | Mechanism                                                                      |
| ------------------------------------------------------------------------------------ | --------------------------------- | ------------------------------------------------------------------------------ |
| Shell controls: `--help`, `-h`, `--help=<mode>`, `--version`, `--json`, root no-args | CLI Canon                         | Node adapter; never a product handler, decoder, or composition-root argv check |
| Presentation mode resolution                                                         | CLI Canon                         | resolved once per invocation (§11.4)                                           |
| Framework failure text, JSON, stream, exit code                                      | CLI Canon                         | §11.5                                                                          |
| Command result payload and its presentation                                          | Product                           | result schema and `NodeCliResultPresenter`, given the mode                     |
| Domain error decision, text/JSON, stream, exit code                                  | Product                           | `DomainErrorAdapter`, given the mode                                           |
| Special surface (protocol, TUI, interactive)                                         | Product, within §11.6 eligibility | `NodeCliSpecialTerminalSurface` or a declared command route                    |

`NodeCliSpecialTerminalSurface` is an explicit opt-out for a product-owned terminal surface that satisfies §11.6. It is not a general hook for restyling standard help, usage, or JSON errors. The 0.1.7 `NodeCliTerminalAdapter` remains importable during migration; move result presentation to `NodeCliResultPresenter`, and move only a genuine special-surface implementation to `NodeCliSpecialTerminalSurface`. Its legacy help and usage callbacks are ignored, so the default path retains one Canon-owned renderer.

### 11.2 Standard shell contract

This section freezes the standard-shell semantics that the Node adapter implements. Later runtime work implements it without reopening these decisions and adds only the minimum public API needed to realize it. Values below are exact. `<usage>` is the usage token list of the canonical help document for the stated target, joined by single spaces; `<message>` is `error.message` for an `Error` and `String(error)` otherwise.

Reserved shell tokens are `--help`, `-h`, `--help=<mode>`, `--version`, and `--json`. A product field whose flag or alias equals `--help`, `-h`, `--version`, or `--json` is rejected at construction with `FLAG_COLLISION`. Shell tokens have no short aliases other than `-h`.

Shell resolution is performed once per invocation, before route resolution, in this order:

1. **Scan.** Tokens before the first `--` are classified with the same declared-option value rules as Help detection: a token consumed as the value of a declared option is a value, not a shell token. A token after `--` is never a shell token.
2. **Presentation mode.** Every scanned `--json` token selects `machine` mode; repetition is idempotent. Otherwise the mode is `human`. All `--json` tokens are removed from the argv passed to the grammar backend and to delegated executors. `--json=<value>` is not the selector; it reaches the grammar and fails as `unknown-option`.
3. **Help.** If a Help token was scanned, the invocation is a Help request (§11.3). Help wins over `--version` and over route resolution.
4. **Version.** If the remaining argv is exactly `["--version"]`, the invocation is a version request (§11.3). Any other occurrence of `--version` is ordinary argv and fails through the grammar as `unknown-option`.
5. **Root no-args.** If the remaining argv is empty, the invocation is a `no-command` usage failure at the root target.
6. **Route.** Otherwise the route is resolved and executed as in §6 and §8.

Exit codes are fixed: `0` success, Help, and version; `2` usage and validation failures; `1` handler-result, unexpected, serialization, and budget failures. Domain failures use the exit code chosen by the product's `DomainErrorAdapter`. Presentation mode changes encoding only; it never changes stream or exit code. Canon writes to stdout only a successful result, Help, or version document, and writes every framework failure to stderr. The stream of a mapped domain failure is product-owned.

### 11.3 Root no-args, Help, and version

**Root no-args.** `<bin>` with no argv (and `<bin> --json` in machine mode) is a usage failure with code `no-command` at the root target. It never prints Help to stdout and never exits `0`. Human projection on stderr, exit `2`:

```text
error: no command selected

Usage: <root usage>
```

A declared group route without a following command segment is the same `no-command` failure with that group's usage. The only exception is a product whose migration ledger classifies root no-args as `special-surface` under §11.6.

**Help.** Help syntax, targets, and modes are §6.2. Human mode writes the `summary` or `full` text projection to stdout, exit `0`. Machine mode writes the `json` discovery projection of the resolved target to stdout, exit `0`, for every valid Help token, regardless of the `summary`/`full` token value or the Node `helpFormat` option. An invalid `--help=<mode>` is a usage failure with code `invalid-help-mode` at the root target in either mode.

**Version.** The only version request is argv `["--version"]` after `--json` removal. The single authority is `CompiledProduct.packageMetadata`, which the product composition root supplies from its own installed `package.json`; a product-local version literal is not permitted. Output is on stdout, exit `0`:

- human: `<packageMetadata.version>` followed by `\n`;
- machine: `{"name":"<packageMetadata.name>","version":"<packageMetadata.version>"}` followed by `\n`, encoded as a compact JSON document.

When `packageMetadata` is absent, `--version` is not admitted: the request fails through the grammar as `unknown-option` with exit `2`. Canon never invents a fallback version.

### 11.4 Presentation context

The presentation mode `"human" | "machine"` is resolved once by §11.2 and carried on every Node execution outcome as `presentation`. It is passed without reparsing to `NodeCliResultPresenter`, to `DomainErrorAdapter`, and to a delegated executor's request. Product handlers, domain decoders, presenters, adapters, and delegated executors must not inspect argv or Canon-rendered stdout to recover the mode or any other shell state.

- Without a presenter, a successful result is the compact JSON of the validated result followed by `\n` on stdout in both modes. This is current behavior.
- With a presenter, the product owns the success presentation for both modes. In machine mode the product's output must be one complete JSON document on stdout.
- A mapped domain error is presented by the product for the given mode. In machine mode its output must be one complete JSON document; stream and exit code remain product-owned.
- A delegated executor owns its terminal result and receives the mode in its request. Delegated routes are `transition-only` (§17.1).
- `NodeCliSpecialTerminalSurface` callbacks are never applied in machine mode.

### 11.5 Framework failure projections

Every framework failure is written to stderr. Human projections, followed by the stated exit code:

| Failure kind                             | Human stderr                                 | Exit |
| ---------------------------------------- | -------------------------------------------- | ---- |
| `usage`                                  | `error: <usage message>\n\nUsage: <usage>\n` | 2    |
| `validation`                             | `INVALID_INPUT: <message>\n`                 | 2    |
| `handler-result`                         | `INVALID_HANDLER_RESULT: <message>\n`        | 1    |
| `unexpected`, and unmapped handler error | `UNEXPECTED: <message>\n`                    | 1    |
| `serialization`, `budget`                | output-policy diagnostic (`OUTPUT_…`)        | 1    |

`<usage message>` is the Canon message for the structured usage code, such as `no command selected` or `unknown option`. `<usage>` uses the failure's resolved target.

Machine projections are one compact JSON document followed by `\n`, with keys in this order and absent optional keys omitted:

```text
usage:          {"error":{"kind":"usage","code":"<StructuredUsageErrorCode>","message":"<usage message>","usage":[<usage tokens>],"commandId":"…","option":"…","value":"…"}}
validation:     {"error":{"kind":"validation","message":"<message>"}}
handler-result: {"error":{"kind":"handler-result","message":"<message>"}}
unexpected:     {"error":{"kind":"unexpected","message":"<message>"}}
```

The machine document never contains backend diagnostics such as `parserCode`. `serialization` and `budget` failures keep the output-policy text diagnostic in both modes, because the output policy cannot guarantee a JSON document within the failed budget. A machine failure document that exceeds `maxOutputBytes` becomes a `budget` failure. A domain failure is never rendered by Canon.

Conformance at base `7e9abc8`: root no-args, Help, invalid Help mode, and all human framework failure projections above are current behavior. Reserved `--version`/`--json`, the version request, machine mode, the machine projections, and the `presentation` context are to be implemented.

### 11.6 Special surfaces

A special surface is eligible only when the invocation's streams are not a single CLI response:

- a protocol surface whose stdin/stdout carry a protocol, such as MCP stdio;
- a full-screen or TTY-interactive surface, such as a TUI or interactive dashboard;
- a long-running streaming or server session started by the invocation.

A special surface is entered through a declared command route, or through root no-args when the ledger classifies root no-args as `special-surface`. In that one case the product composition root may test exactly `argv.length === 0` before calling CLI Canon; no other argv inspection outside CLI Canon is permitted.

Not eligible: legacy Help layout or wording, legacy usage or error text, legacy JSON error envelopes, alternative version output, alternative no-args Help, changed exit codes or streams for framework failures, and any behavior selected by `--json`. A special surface does not change `--help`, `--version`, or machine-mode behavior of the rest of the product.

## 12. Path Canon direction

Path Canon is a future CLI Canon layer, not part of M0.

Its architectural boundary is already fixed:

- paths are addresses, not permissions
- IDs are inferred from path declarations
- resolution receives explicit context such as cwd/home/platform/env when relevant
- path references may compose from other path references
- cycles and invalid references fail during compilation
- resolution itself does not mkdir/chmod/delete or grant authorization
- filesystem ownership, symlink safety, race handling, and write permission remain in the consumer domain

Do not implement product filesystem policy in the future Path Canon.

## 13. Skill Canon direction

Skill Canon is a future layer.

A Skill owns intent-oriented guidance, not command syntax.

A Skill step references a canonical Command ID.

The framework derives:

- command route
- usage
- help pointer
- invocation metadata

A Skill may also contain a prose-only step when no command exists.

A Skill must not:

- duplicate exact flag tables
- reconstruct domain lifecycle decisions
- turn a placeholder command into an executable argv
- reference an unknown command
- silently truncate required workflow/invariant content

If required bindings are unavailable, the projection reports a prerequisite or requires-input state instead of inventing values.

## 14. Fixture and certification rule

Fixtures serve two different purposes and must not be confused.

### 14.1 Shared scenario input

It is useful to define one scenario and run it against source, built JS, and packed installation.

### 14.2 Independent oracle

Expected public behavior must remain independent where independence is required to detect a defect.

Do not generate expected help by calling the same help projector being tested.

Do not regenerate an expected snapshot automatically and treat the update as proof.

Keep decisive expectations independent for:

- argv semantics
- exit codes
- rejection behavior
- public required fields
- package exports/assets
- established product compatibility classified `preserve-domain` or `special-surface`

## 15. Package boundaries

Current package:

```text
@yohn-jp/cli-canon
@yohn-jp/cli-canon/node
```

The root is the pure authoring/compiler/projection surface.

The Node subpath owns the Commander adapter.

A future testing subpath may be added only when reusable test/package primitives actually exist. Do not publish an empty abstraction in advance.

Do not split CLI Canon into multiple npm packages without a demonstrated ownership boundary.

## 16. Dependency policy

Current M0 baseline:

- Node >= 24
- TypeScript 6.0.3
- Zod 4.6.5
- Commander 15.0.0
- pnpm 11.18.0

Zod is part of the authoring contract. Commander is private implementation.

Do not add Effect or an alternate schema/parser abstraction merely to preserve optionality.

A new dependency needs a current concrete requirement that is not sufficiently served by platform-native capability or an existing dependency.

## 17. Consumer migration rule

Migration is contract-by-contract, not repository-by-repository flag day. Migration is Canon-first: the target of every standard-shell behavior is §11, not the product's historical CLI.

Before replacing an existing CLI path:

1. capture the existing public behavior with independent compatibility fixtures as evidence
2. classify every captured behavior that differs from Canon or is touched by the migration in the change ledger (§17.1)
3. map the command declaration to CLI Canon
4. bind the existing domain handler/authority
5. prove `preserve-domain` and `special-surface` entries unchanged, and prove `converge-to-canon` entries match §11
6. remove the old parser/help/dispatcher/shell authority for that migrated surface
7. run source, built, and packed verification

A migrated command must not have two live authorities.

Partial migration is allowed only when route ownership is explicit and non-overlapping.

Do not opportunistically refactor the consumer domain during framework adoption.

### 17.1 Change ledger

Each consumer migration carries a change ledger in the consumer repository, in the migration Issue or PR. CLI Canon holds no product ledger, product compatibility table, or product-specific exception. Every legacy behavior in scope has exactly one of these classes:

| Class               | Applies to                                                                                                                                                                                                                                 | Target                                                                   | Fixture role                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `preserve-domain`   | Product-owned semantics: command identity and route, argv meaning of admitted grammar, result payload, domain error decision and its product-chosen text/stream/exit, authorization, lifecycle, provider effects                           | unchanged                                                                | decisive independent oracle; unchanged                       |
| `converge-to-canon` | Standard-shell behavior: Help layout and wording, usage and framework error text, root no-args, version syntax and output, machine selector, framework failure stream and exit code, product-local `--json` flags used as a shell selector | exactly §11; the consumer does not reproduce the legacy form             | expectation rewritten to the Canon output in the same change |
| `transition-only`   | Legacy behavior kept temporarily through deprecated or delegating APIs: `legacyRoutes`, `NodeCliTerminalAdapter`, delegated sources for unmigrated routes                                                                                  | removed by a named follow-up; never extended; not reported as conformant | kept only until the named removal                            |
| `special-surface`   | An invocation that satisfies §11.6                                                                                                                                                                                                         | unchanged product-owned surface                                          | decisive independent oracle; unchanged                       |

Classification rules:

1. A standard-shell behavior (§11.2) is `converge-to-canon` unless it satisfies §11.6. It is never `preserve-domain`.
2. `special-surface` requires §11.6 eligibility. It cannot be used to keep a legacy Help layout, usage text, or JSON error envelope.
3. `transition-only` names its removal condition. A behavior without one is misclassified.
4. Historical product behavior may change only when its entry is `converge-to-canon`. An unclassified difference blocks the migration.
5. A consumer compatibility fixture is evidence for classification, not automatically the target output. Byte-for-byte restoration of a legacy shell is not a migration goal.

### 17.2 Ordinary product change

After adoption, adding a command, adding an optional option, editing Help content, and extending a domain result are single-repository product changes. They require no CLI Canon code change or release. CLI Canon must not require product registration, catalogs, or product names in its own source.

## 18. Recommended consumer order

The current rollout direction is:

```text
Wabachi
  -> Suzukuri
  -> Nawabari
  -> Inari
  -> Mottainai
```

This is an implementation sequencing choice, not a product-quality ranking.

Wabachi provides a small first vertical consumer.
Suzukuri proves library/CLI separation and bounded projections.
Nawabari stresses grammar and strong derived types.
Inari stresses large command contracts and dynamic domain authorities.
Mottainai stresses gradual migration from a large handwritten CLI and special entrypoint behavior.

## 19. Rules for future CLI Canon implementations

When extending CLI Canon:

1. Implement only a behavior required by an accepted consumer or framework contract.
2. Prefer deriving information over adding parity tests between duplicate authorities.
3. Do not add future-facing abstraction points without a current second use or a canonical requirement.
4. Keep framework errors separate from consumer domain errors.
5. Preserve established consumer behavior classified `preserve-domain` or `special-surface`; standard-shell behavior converges to §11 through the ledger (§17.1).
6. Reject unsupported grammar explicitly.
7. Keep public models immutable and serializable projections free of executable state.
8. Prove public types from the packed package, not only repository source.
9. Keep root import side-effect free.
10. Stop at the requested layer; adding Path, Skill, MCP, HTTP, or lifecycle support is not implied by adjacent work.

## 20. Definition of a canonical feature

A CLI Canon feature is complete only when all applicable parts are true:

- one authoring authority exists
- IDs/types derive from it
- relationships are compiler-validated
- runtime input is decoded before use
- projections consume the compiled model
- no second framework-owned authority remains
- public import boundaries are explicit
- source behavior is tested
- built behavior is tested
- packed consumer behavior is tested
- known unsupported cases fail explicitly
- consumer domain authority has not been duplicated or weakened

Passing a unit test alone is not sufficient.

## 21. M0 reference

M0 establishes the Command Canon vertical slice.

Canonical public direction:

```ts
const commands = defineCommands({
  "document.render": {
    route: ["document", "render"],
    summary: "Render a document.",
    input: {
      file: positional(z.string()),
      out: option("--out", z.string(), { required: true }),
      force: flag("--force"),
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
});

const outcome = await runNodeCli(product, ["document", "render", "input.md", "--out", "out.html"]);
```

The exact implementation lives in source. This example communicates the ownership model: declare once, bind typed domain behavior, compile once, project everywhere.

## 22. Non-goals

CLI Canon is not:

- a general-purpose public CLI framework
- a domain framework
- an authorization framework
- a state-machine framework
- a filesystem security framework
- an MCP framework
- a dependency-injection framework
- an abstraction over every TypeScript schema library
- a compatibility layer over multiple CLI parsers

It is the canonical internal foundation for yohn-jp TypeScript CLI products.

Its value comes from making duplication and drift structurally difficult, not from owning every concern.
