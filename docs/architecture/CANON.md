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
3. Existing public contracts and compatibility fixtures define behavior that must be preserved.
4. Existing implementation is evidence, not authority when it conflicts with the above.

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
- compatibility fixture: preservation of established external behavior

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

Authority boundary: the consumer product owns product/domain content, including group and command IDs, route tokens, summaries, descriptions, and examples. CLI Canon owns the standard CLI structure vocabulary, the runtime, and presentation derived from it. Group metadata is generic presentation content, not product logic.

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
- established product compatibility

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

Migration is contract-by-contract, not repository-by-repository flag day.

Before replacing an existing CLI path:

1. capture the existing public behavior with independent compatibility fixtures
2. map the command declaration to CLI Canon
3. bind the existing domain handler/authority
4. prove argv/help/output compatibility
5. remove the old parser/help/dispatcher authority for that migrated surface
6. run source, built, and packed verification

A migrated command must not have two live authorities.

Partial migration is allowed only when route ownership is explicit and non-overlapping.

Do not opportunistically refactor the consumer domain during framework adoption.

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
5. Preserve established consumer behavior unless the accepted work explicitly changes it.
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
