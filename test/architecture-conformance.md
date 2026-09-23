# CLI Canon architecture conformance certification

**Subject:** Issue #15, pre-consumer framework contract
**Base:** `origin/main` at `e38276b0d5a209cd0a34cf4be8e37f68773f74eb`
**Audited documents:** [`CANON.md`](../docs/architecture/CANON.md) and [`cli-canon.md`](../docs/architecture/cli-canon.md)
**Implementation evidence:** this base tree plus the narrowly scoped Issue #15 corrections described below.

The `cli-canon.md` document is marked Proposed, but Issue #15 explicitly makes both architecture documents the certification checklist. Declarative architecture clauses are therefore audited here. Historical product survey, sequencing, and rationale text is not treated as a new framework feature. Each checklist row receives exactly one status; there is no unclassified requirement. Section crosswalk rows at the end ensure every architecture-document section is accounted for; they point to, rather than duplicate, the detailed proof rows.

`PROVEN` means the current framework has direct implementation and/or executable evidence. `EXPLICITLY_UNSUPPORTED` means the architecture-required fail-closed construction error is tested. `NOT_APPLICABLE` means the clause is an out-of-scope consumer/release activity, historical rationale, or non-feature boundary; the reason is stated, not silently omitted.

## Detailed conformance matrix

Evidence names refer to test titles in the listed test files. Expected help, JSON, path, package, and output values in the certification scenarios are handwritten in tests/oracles; the production projector is never used to construct its own expected value.

### Command grammar

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| CMD-01 | Nested routes compile, route, and dispatch from the command catalog. | PROVEN | `test/runtime/contract.test.mjs`: “one command canon drives routing…” and `helpFixture`; `src/node/runner.ts`. |
| CMD-02 | Required positional input is represented and decoded. | PROVEN | `contract.test.mjs`: fixture routes and “zod rejects invalid runtime input…”; `test/types/contracts.ts`. |
| CMD-03 | Optional positional input is accepted when absent and supplied when present. | PROVEN | `contract.test.mjs`: “optional positional and optional-value option grammar…”; packed type/runtime scenario in `test/package/consumer.mjs`. |
| CMD-04 | Boolean flags are distinct from value options. | PROVEN | `contract.test.mjs`: `--json` result and handler assertions; `src/command/fields.ts`. |
| CMD-05 | Required-value options work with separate-token and equals forms; absent value is rejected. | PROVEN | `contract.test.mjs`: `--out=out.html`, `-o out.html`, and “unknown options, surplus positionals, and missing required option fail closed” including trailing `--out`. |
| CMD-06 | Optional-value options support no value, separate value, and `--name=value`. | PROVEN | `contract.test.mjs`: “optional positional and optional-value option grammar…”; exact full usage in progressive help test. |
| CMD-07 | Aliases resolve to their declared field. | PROVEN | `contract.test.mjs`: `-o` alias in “one command canon drives routing…”; type declaration in `test/types/contracts.ts`. |
| CMD-08 | Repeated options preserve repeated values. | PROVEN | `contract.test.mjs`: repeated `--tag a --tag=b`; runner accumulates occurrences in `src/node/runner.ts`. |
| CMD-09 | Options declared `placement: "anywhere"` are accepted before their route. | PROVEN | `contract.test.mjs`: “declared anywhere flags work before the nested route” and “declared anywhere required-value options work before a nested route”. |
| CMD-10 | `--name=value` is parsed for required and optional options, including a required value before its route. | PROVEN | `contract.test.mjs`: `--out=out.html`, `--tag=b`, `--format=full`, and `--repository=owner/project` before the route; packed scenario. |
| CMD-11 | `--` forwards following tokens as raw argv, including option-looking tokens. | PROVEN | `contract.test.mjs`: “one command canon drives routing…” expects `args: ["--literal", "tail"]`; raw-args declaration in `src/command/fields.ts`. |
| CMD-12 | Unknown options fail closed. | PROVEN | `contract.test.mjs`: “unknown options, surplus positionals, and missing required option fail closed”. |
| CMD-13 | Surplus positional values fail closed. | PROVEN | Same named test in `contract.test.mjs`; `allowExcessArguments(false)` in `src/node/runner.ts`. |
| CMD-14 | Missing required option and missing required option value fail as usage errors. | PROVEN | Same named test in `contract.test.mjs` includes both no `--out` and terminal `--out`; focused test run passed. |
| CMD-15 | M0 `optionLookingValuePolicy: "consume"` consumes an option-looking required value. | PROVEN | `contract.test.mjs`: “option-looking tokens are consumed as required option values by the M0 grammar” checks `--json` and `--help`. |
| CMD-16 | `optionLookingValuePolicy: "reject"` is not supported by Commander and is rejected at construction as `UNSUPPORTED_GRAMMAR`. | EXPLICITLY_UNSUPPORTED | `contract.test.mjs`: “unsupported ordered groups and option-looking-value rejection fail during construction”; `src/command/compiler.ts`. |
| CMD-17 | Order-sensitive repeated option groups are not preserved by Commander and are rejected at construction as `UNSUPPORTED_GRAMMAR`, not flattened or reparsed. | EXPLICITLY_UNSUPPORTED | Same named test in `contract.test.mjs`; `orderedOptionGroups` compiler branch in `src/command/compiler.ts`. |
| CMD-18 | Duplicate routes, conflicting global flags, and malformed field grammar fail during compilation. | PROVEN | `contract.test.mjs`: “compileProduct rejects duplicate routes and conflicting anywhere flags”; `src/command/compiler.ts`. |

### Help and discovery

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| HELP-01 | Root help is projected from the compiled command catalog. | PROVEN | `contract.test.mjs`: “progressive text, full, and JSON help share command canon metadata”; independent exact root string. |
| HELP-02 | Domain/progressive help lists the next route level deterministically. | PROVEN | Same test asserts exact `domain` help; route help implementation in `src/projection/help.ts`. |
| HELP-03 | Leaf help and generated usage reflect the command declaration. | PROVEN | Same test asserts exact leaf/full usage; `renderHelp` consumes `CompiledProduct`. |
| HELP-04 | Full help includes descriptions, field metadata, and examples. | PROVEN | Same test asserts exact full help plus runtime `--help=full`; descriptions/examples are declared in `helpFixture`. |
| HELP-05 | `--help`, `--help=full`, and `--help=json` are supported at root/domain/leaf scope. | PROVEN | `contract.test.mjs`: progressive text/full/JSON test, including root-before-route and domain JSON; `src/node/runner.ts`. |
| HELP-06 | JSON help equals JSON discovery for the selected Canon scope and remains valid JSON. | PROVEN | Same test compares JSON help to a handwritten exact discovery object; `public-contract.test.mjs`. |
| HELP-07 | Command descriptions, examples, usage, option/positional descriptions, metavar, aliases, presence, arity, and placement project from Canon. | PROVEN | Exact full help and JSON field object in `contract.test.mjs`; `src/projection/help.ts` and `src/projection/discovery.ts`. |
| HELP-08 | Command ordering is deterministic and does not depend on declaration insertion order. | PROVEN | `contract.test.mjs`: “help and discovery order is deterministic across declaration insertion order” compares both declaration permutations to independent exact expectations. |
| HELP-09 | No second framework-owned help/usage table is needed for the audited surface. | PROVEN | Help, usage, and discovery use compiled commands/fields (`src/projection/help.ts`, `src/projection/discovery.ts`, `src/node/runner.ts`); exact independent expectations in `contract.test.mjs`. |

### Output and CliIO

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| OUT-01 | Success produces stdout and exit 0. | PROVEN | `contract.test.mjs`: successful render; `output.test.mjs`: `jsonOutput` and `toCliResult`; independent success oracle in `fixture-oracle.mjs`. |
| OUT-02 | Usage/parser failure is distinguished from input/decode failure. | PROVEN | `contract.test.mjs`: usage cases vs Zod `INVALID_INPUT`; `test/runtime/fixture-oracle.mjs` records validation exit/kind. |
| OUT-03 | Product/domain failure mapping is explicit and preserves mapped exit, stream, and classification. | PROVEN | `output.test.mjs`: “Node runner uses the typed optional product domain error adapter”; no shared domain taxonomy is introduced. |
| OUT-04 | Handler-result validation failure is distinguished. | PROVEN | `contract.test.mjs`: “result schema rejects a handler result…”; `failureKind: handler-result`. |
| OUT-05 | Unexpected framework/handler failure is distinct and non-success. | PROVEN | `output.test.mjs`: “Node runner applies the byte budget… and preserves unexpected failures”. |
| OUT-06 | Serialization failure cannot report success and is distinct from result validation. | PROVEN | `output.test.mjs`: JSON serialization failures and “Node result serialization failure is distinct…”. |
| OUT-07 | Stream, stdout/stderr, exit code, and failure classification form one outcome. | PROVEN | `output.test.mjs`: “CliIO writes the outcome stream…” checks exact writes and `CliResult`; domain adapter exact outcome. |
| OUT-08 | UTF-8 budget is applied to encoded final output, with below/equal/above-cap behavior. | PROVEN | `output.test.mjs`: “JSON byte budget includes Unicode and the final newline at below, exact, and above limits”; `src/output/policy.ts`. |
| OUT-09 | Multibyte Unicode and the final newline count toward the exact byte budget. | PROVEN | Same test compares `Buffer.byteLength` for `雪` and exact emitted `\n`. |
| OUT-10 | Valid JSON is never byte-truncated: below-cap result is a budget failure on stderr, not a partial success document; exact/above outputs parse fully. | PROVEN | Same output test asserts below-cap failure/empty output, exact and above success, and `JSON.parse` of the complete exact output; packed consumer repeats boundary behavior. |
| OUT-11 | Skill text and JSON share output-budget behavior and reject rather than silently truncate. | PROVEN | `skill.test.mjs`: “bounded Skill text and JSON use the shared byte budget without truncation”; `src/skill/projection.ts`. |

### Path Canon

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| PATH-01 | Path IDs and required parameter names derive from declarations. | PROVEN | `test/types/path-canon.ts`: positive/negative `PathId` and `PathParameterName`; `path-canon.test.mjs`. |
| PATH-02 | Required path parameters are typed and runtime-validated; missing, unknown, invalid type/value fail explicitly. | PROVEN | `path-canon.test.mjs`: “path parameters are required…” and “invalid path context values…”; type tests reject missing/extra. |
| PATH-03 | File/directory kind is explicit descriptive metadata. | PROVEN | `path-canon.test.mjs`: file vs default directory; packed consumer checks manifest kind; `src/path/model.ts`. |
| PATH-04 | cwd, home, environment, platform, fixed roots, and default roots are supplied/selected explicitly. | PROVEN | `path-canon.test.mjs`: “path IDs and parent references…”, Windows case, and ordered root strategies; `resolvePaths` uses only `PathResolutionContext`. |
| PATH-05 | Environment/platform/default override precedence is explicit and ordered. | PROVEN | `path-canon.test.mjs`: “ordered root strategies honor env, platform, and default precedence”, including relative env fallback and invalid late override. |
| PATH-06 | POSIX and Windows lexical path behavior is covered. | PROVEN | `path-canon.test.mjs`: POSIX normalization and `win32` drive/root/segment runtime resolution; packed consumer exercises the same public Path API on POSIX. |
| PATH-07a | Intentional lexical aliases may resolve to the same address by referencing one declared Path. | PROVEN | `path-canon.test.mjs`: `projectAlias` references `project` and resolves to the same address without a collision rejection. |
| PATH-07 | Unknown references, cycles, invalid declarations, and lexical traversal segments are rejected. | PROVEN | `path-canon.test.mjs`: “unknown references, cycles, and traversal segments fail during compilation”; structured errors in `src/path/paths.ts`. |
| PATH-08 | Resolution requires explicit valid context; no hidden process-global cwd/home/env/platform reads occur. | PROVEN | `path-canon.test.mjs`: missing/relative context rejection; `src/path/paths.ts` uses passed context and lexical helpers only; no process/OS import. |
| PATH-09 | Resolution has no filesystem mutation or existence/permission/authorization semantics. | PROVEN | `path-canon.test.mjs`: absent root remains absent before/after resolution; `src/path/paths.ts` performs lexical operations only; no authorization fields/API. |

### Skill Canon

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| SKILL-01 | Skill IDs derive from the declared catalog. | PROVEN | `test/types/skill-contracts.ts`: positive/negative `SkillId`; `skill.test.mjs`. |
| SKILL-02 | Skill command steps use Command IDs and invalid/unknown IDs fail. | PROVEN | Type tests and `skill.test.mjs`: “Skill compilation rejects unknown command references at construction”. |
| SKILL-03 | Prose-only steps remain valid. | PROVEN | `skill.test.mjs`: prose steps in command-backed and no-command Skills; type test `proseOnlySkills`. |
| SKILL-04 | Missing command bindings/prerequisites are represented as `requires-input`, not executable argv. | PROVEN | `skill.test.mjs`: “Skill projection derives command metadata…” expects field/prerequisite requirements; `src/skill/projection.ts`. |
| SKILL-05 | Intent, invariants, and opaque domain-result references project without recomputing their meaning. | PROVEN | `skill.test.mjs`: “Skill metadata and delegation…” checks exact metadata/text; `src/skill/projection.ts` copies references. |
| SKILL-06 | Public Skill projection cannot reference private Commands; visibility values are validated. | PROVEN | `skill.test.mjs`: “Skill compilation rejects unknown delegation, cycles, and private commands”; `src/skill/compiler.ts`. |
| SKILL-07 | Delegation references are validated and delegation cycles rejected. | PROVEN | Same skill test; `test/types/skill-contracts.ts` positive/negative delegation IDs. |
| SKILL-08 | Skill text/JSON output is deterministic, complete, and valid JSON. | PROVEN | `skill.test.mjs`: independent exact text, long content intact, repeated text/JSON equality, JSON parse equality. |
| SKILL-09 | Bounded Skill output uses shared output policy and fails explicitly instead of truncating. | PROVEN | `skill.test.mjs`: exact-cap success and below-cap `OutputPolicyError` for text and JSON. |
| SKILL-10 | Skill remains guidance/projection; product lifecycle, authorization, and domain-result decisions are not recomputed. | PROVEN | `src/skill/projection.ts` projects declared metadata and derives only generic required-input state; tests preserve opaque result references/invariants; no domain engine/API exists. |

### Product and public contract

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| PUB-01 | Product identity projects package name, version, and bin metadata supplied by the package composition root. | PROVEN | `public-contract.test.mjs`: “discovery projects only package name, version, and bin identity…”; `ProductPackageIdentity`; packaged fixture imports package metadata. |
| PUB-02 | Package identity has no second framework version literal or ambient package lookup. | PROVEN | `package.json` is the package-version authority; `src/product/identity.ts` and `CompileProductInput.packageMetadata` require explicit supplied metadata; `projectDiscovery` copies it. `src/**` contains no package version literal. |
| PUB-03 | Public discovery is JSON-safe data and omits handlers, functions/secrets, Zod/Commander instances, and internal runtime state. | PROVEN | `public-contract.test.mjs` JSON roundtrip and explicit `handlers`/`privateKey` exclusion; `src/projection/discovery.ts` constructs an allowlisted projection. |
| PUB-04 | Framework-owned schemas distinguish `complete` from `structural-only` and identify input/output direction. | PROVEN | `public-contract.test.mjs`: “compiled input and output schemas…” and schema completeness test; `src/projection/schema.ts`. |
| PUB-05 | A schema that cannot truthfully be projected as complete fails explicitly; structural-only remains labelled. | PROVEN | `public-contract.test.mjs`: transform/refinement cases assert `SchemaProjectionError` and `structural-only`. |
| PUB-06 | Testing-only certification API is outside the root runtime exports/import graph. | PROVEN | `src/index.ts` does not export `src/testing`; packed consumer asserts root lacks `certifyScenarios`; package purity test. |

### Exact packed distribution

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| DIST-01 | The exact produced tarball contains package metadata, root/node/testing JS and declaration files, with matching exports. | PROVEN | `test/package/consumer.mjs` runs `pnpm pack`, lists/extracts that single `.tgz`, asserts files and export map. |
| DIST-02 | Public root, Node subpath, and testing subpath runtime imports and public type imports work from the installed tarball. | PROVEN | Same package consumer installs `file:${tarball}`, executes all three APIs, and invokes TypeScript against root/node/testing imports. |
| DIST-03 | Root import is pure for the exact tarball and built entry; source root consists only of the same declarations/projection exports. | PROVEN | `test/package/root-import-purity.mjs` guards argv, exit, streams, signal handlers, filesystem, process, and network effects; invoked for installed tarball and built output; `src/index.ts` is export-only. |
| DIST-04 | Node adapter is isolated at `@yohn-jp/cli-canon/node`; testing helpers do not leak to root. | PROVEN | Packed export map/type/runtime consumer assertions and `src/index.ts`. |
| DIST-05 | Source, built JS, and exact packed package share an independent scenario oracle where applicable. | PROVEN | `fixture.test.mjs` certifies the same oracle against source and built lanes; packed consumer uses copied `fixture-scenario.mjs` and `fixture-oracle.mjs` against the one installed tarball. |
| DIST-06 | Packed expected behavior is independent of the production projector; dry-run/source-only evidence is not substituted. | PROVEN | `fixture-oracle.mjs` contains literal expected help/discovery/output; `consumer.mjs` installs and runs the exact tarball created by `pnpm pack`. |

### C01–C12 invariant acceptance map

| Invariant | Status | Evidence |
| --- | --- | --- |
| C01 — command/path/Skill IDs are declaration-derived. | PROVEN | `test/types/contracts.ts`, `path-canon.ts`, `skill-contracts.ts`; `CMD-01`, `PATH-01`, `SKILL-01`. |
| C02 — command owns typed input/handler/result; executable commands cannot lack a binding. | PROVEN | Positive/negative handler types, runtime missing/extra handler construction rejection, and result validation; `test/types/contracts.ts`, `contract.test.mjs`. |
| C03 — invalid references, collisions, cycles, and unsupported grammar fail at construction. | PROVEN | Command, Path, Skill construction-error tests; `CMD-16/17` classify the two backend limits explicitly. |
| C04 — parser, usage, help, discovery, and Skill invocation metadata derive from CompiledProduct. | PROVEN | `contract.test.mjs`, `skill.test.mjs`; `src/node/runner.ts`, `src/projection/*`, `src/skill/projection.ts`. |
| C05 — untrusted argv is decoded before handlers. | PROVEN | `contract.test.mjs`: invalid Zod input fails before success; `src/node/runner.ts`. |
| C06 — consumer domain schema, authorization, and lifecycle decisions are not duplicated. | PROVEN | Opaque domain adapter/reference tests; framework has generic mapping/projection only and no consumer imports or migrations. |
| C07 — Path is an address, not permission, and resolution is side-effect free. | PROVEN | `PATH-07–09`; `src/path/paths.ts`. |
| C08 — complete output/error/exit contract; JSON and required guidance are not silently truncated. | PROVEN | `OUT-01–11`, `SKILL-08/09`. |
| C09 — root imports remain side-effect free. | PROVEN | `DIST-03`, exact packed and built import purity tests. |
| C10 — reusable scenario input coexists with an independent expected oracle. | PROVEN | `fixture-scenario.mjs`, `fixture-oracle.mjs`, source/built and packed package tests. |
| C11 — existing consumer public behavior is preserved during framework adoption. | NOT_APPLICABLE | No consumer repository or consumer public contract is changed or claimed in this pre-consumer certification. Framework contract cases are independently tested; consumer migrations remain gated. |
| C12 — checked-in generated artifacts are regenerated/checked from authority. | NOT_APPLICABLE | This repository has no checked-in generated Canon artifacts or generator/check command. TypeScript build output is produced during verification and is not a maintained generated source table. |

## Architecture-document coverage crosswalk

Every numbered section in both audited documents is listed. Where a section contains multiple status classes, its subclauses are split into separate rows. Evidence IDs above are the detailed requirement rows.

| Source | Requirement coverage | Status | Evidence / applicability |
| --- | --- | --- | --- |
| CANON.md §1 | Authority hierarchy is an execution/governance rule, not runtime framework behavior. | NOT_APPLICABLE | Followed for this certification; no framework feature is implied. |
| CANON.md §2 | One authoring authority compiles to a model consumed by runtime and projections. | PROVEN | CMD, HELP, SKILL, PUB rows. |
| CANON.md §3 | Framework owns CLI structure but not product domain semantics. | PROVEN | PUB-03, OUT-03, PATH-09, SKILL-10; no consumer changes. |
| CANON.md §§4.1–4.3 | Typed Authoring Model, compiled representation, validated relationships, safe public projection. | PROVEN | C01–C05, C09; runtime mutation test proves command-definition and handler-map snapshots; `src/command/compiler.ts`, `src/projection/discovery.ts`. |
| CANON.md §§5.1–5.3 | IDs and handler/result types derive from declarations; public types stay schema-inferred; runtime compiler validates bindings and input; type/compiler/runtime/domain/fixture checks are distinct. | PROVEN | C01–C06, packed/type tests, `INVALID_HANDLER_BINDING` runtime tests, and `src/command/handlers.ts`. |
| CANON.md §6 | Command declaration owns ID/route/summary/input/result/handler; no second dispatcher. | PROVEN | CMD rows; `src/node/runner.ts`. |
| CANON.md §7 | CLI syntax and value schemas are distinct; consumer domain schemas stay external. | PROVEN | CMD rows, PUB-04/05, C06. |
| CANON.md §8 | Commander is private Node adapter; invocation state isolated; root import has no listed process/I/O/network/filesystem effects; adapter returns outcome. | PROVEN | DIST-03, OUT-07, `src/node/runner.ts`; commander is an implementation dependency, not a public export. |
| CANON.md §9 | Supported grammar is explicit; unknown/surplus input fails closed; no fallback parser; unsupported syntax rejects. | PROVEN | CMD-09–18. |
| CANON.md §9a | Ordered repeated option groups cannot preserve occurrence ordering on current backend. | EXPLICITLY_UNSUPPORTED | CMD-17 construction-time `UNSUPPORTED_GRAMMAR`. |
| CANON.md §9b | Rejecting option-looking required values is not provided by current backend. | EXPLICITLY_UNSUPPORTED | CMD-16 construction-time `UNSUPPORTED_GRAMMAR`; M0 consume behavior is CMD-15. |
| CANON.md §10 | Help/discovery/Skill are projections, not authorities. | PROVEN | HELP-01–09, SKILL-02/04, PUB-03. |
| CANON.md §11 | Success and all specified failures are explicit; JSON is complete; no silent success/truncation. | PROVEN | OUT-01–11. |
| CANON.md §12 | Path IDs/references/context are explicit; address-only resolution has no permission or filesystem operation. | PROVEN | PATH-01–09. |
| CANON.md §13 | Skill steps reference commands or prose; required input is explicit; no domain decision recomputation. | PROVEN | SKILL-01–10. |
| CANON.md §14 | Shared scenario input uses independent oracle for argv/outcomes/public fields/package behavior. | PROVEN | DIST-05/06 and C10. |
| CANON.md §15 | Root/Node/testing package boundaries are explicit; testing surface is separated. | PROVEN | PUB-06, DIST-01–04. |
| CANON.md §16 | Current Node/TypeScript/Zod/Commander baseline and dependency shape are declared; no alternate parser/schema framework added. | PROVEN | `package.json`, lockfile, `src/node/runner.ts`; no new dependencies in this certification. |
| CANON.md §17 | Consumer-by-consumer migration and compatibility-corpus changes. | NOT_APPLICABLE | No consumer migration is part of Issue #15; no consumer repository is modified. |
| CANON.md §18 | Recommended order of consumer migrations. | NOT_APPLICABLE | Sequencing is not a framework runtime contract; no migration is started. |
| CANON.md §19 | Future extension rules: no hidden parser, no duplicate authority, no domain ownership, explicit unsupported grammar, safe public API. | PROVEN | CMD-16/17, C01–C10, DIST-01–06. |
| CANON.md §20 | Definition of a complete canonical feature (authority, IDs, references, decode, projection, boundaries, source/build/pack, unsupported cases). | PROVEN | C01–C10 and DIST rows. |
| CANON.md §21 | M0 example capabilities are representative, not a separate API obligation. | PROVEN | `contract.test.mjs`: typed command, input, alias, flag, result, compiled runtime. |
| CANON.md §22 | General framework/product-domain/MCP/authorization/filesystem-security non-goals. | PROVEN | Package/API and dependency boundary plus PATH-09/SKILL-10/C06; no such feature is implemented or claimed. |
| cli-canon.md §1 | Product structure is compiled once from typed declarations; chosen stack is reflected in package. | PROVEN | CMD, HELP, PUB; `package.json`. |
| cli-canon.md §2.1–2.3 | Historical consumer survey, commit observations, and prior implementation caveats. | NOT_APPLICABLE | This is not a consumer audit; Issue #15 asks only to re-evaluate the Wabachi help blocker, certified below. No other consumer state is asserted. |
| cli-canon.md §3.1 | Command/Input/Path/Skill/Output/Package authorities project rather than duplicate facts. | PROVEN | CMD, HELP, PATH, SKILL, OUT, PUB, DIST rows. |
| cli-canon.md §3.2 | Product-owned authorization, lifecycle, provider, filesystem, transport, CI/release semantics remain outside Canon. | PROVEN | C06, PATH-09, SKILL-10; no product or `.github/**` changes. |
| cli-canon.md §4.1 | TypeScript + Zod + Commander is the selected implementation baseline; alternatives are not silently introduced. | PROVEN | `package.json`, `pnpm-lock.yaml`, `src/node/runner.ts`. |
| cli-canon.md §4.2 | One schema/parser backend; no generic plugin/alternate-backend framework; explicit package boundary. | PROVEN | Package dependencies and exports; no new dependency or backend. |
| cli-canon.md §4.3 | Backend admission corpus is proven or explicitly rejected; no hidden fallback. | PROVEN | CMD-01–18, including EXPLICITLY_UNSUPPORTED entries. |
| cli-canon.md §4.4a | Dependency identity/version is locked and not duplicated in product runtime source. | PROVEN | `package.json`, `pnpm-lock.yaml`, PUB-01/02. |
| cli-canon.md §4.4b | New dependency security/license/performance/cold-start comparison measurements. | NOT_APPLICABLE | No dependency/backend change is proposed by certification; no new measurement or security claim is made. |
| cli-canon.md §5.1 | Authoring, CompiledProduct, and public projections are separated. | PROVEN | CMD/HELP/PUB and C01–C05. |
| cli-canon.md §5.2 | Root, Node, and testing subpath boundaries and import purity. | PROVEN | DIST-01–04. |
| cli-canon.md §6 / C01 | Command/Path/Skill identities are derived. | PROVEN | C01. |
| cli-canon.md §6 / C02 | Command owns input and binding; executable handler types are exact and runtime catalog bindings are validated. | PROVEN | C02; missing/unknown handler construction tests. |
| cli-canon.md §6 / C03 | Invalid relationships/collisions/grammar/path cycles reject. | PROVEN | C03, CMD-16/17. |
| cli-canon.md §6 / C04 | Runtime/help/Skill/discovery share compiled facts. | PROVEN | C04. |
| cli-canon.md §6 / C05 | Input decodes before handler. | PROVEN | C05. |
| cli-canon.md §6 / C06 | Domain schemas/authorization/decisions are not duplicated. | PROVEN | C06. |
| cli-canon.md §6 / C07 | Path resolution is lexical/address-only. | PROVEN | C07. |
| cli-canon.md §6 / C08 | Output and bounded rendering fail explicitly and consistently. | PROVEN | C08. |
| cli-canon.md §6 / C09 | Root import is pure. | PROVEN | C09. |
| cli-canon.md §6 / C10 | Oracle independence is maintained. | PROVEN | C10. |
| cli-canon.md §6 / C11 | Existing consumer public compatibility during migration. | NOT_APPLICABLE | No consumer migration or compatibility claim in Issue #15. |
| cli-canon.md §6 / C12 | Checked-in generated artifacts are regenerated and diff-checked. | NOT_APPLICABLE | No checked-in generated Canon artifacts/generator exists; see C12. |
| cli-canon.md §7.1–7.2 | Typed API shape, field/cardinality authority, and no duplicate presence/default facts. | PROVEN | CMD-02–08; `test/types/contracts.ts`; `src/command/fields.ts`. |
| cli-canon.md §7.3 | Existing consumer domain decoders are retained at handler boundary. | PROVEN | Generic typed domain adapter and opaque Skill result refs; no consumer domain schemas or imports in framework. |
| cli-canon.md §7.4 | Schema projection distinguishes complete/structural-only and rejects false completeness. | PROVEN | PUB-04/05. |
| cli-canon.md §8.1a | Compiler validates declarations, references, grammar, Path/Skill relations, and command/handler bindings before execution. | PROVEN | Construction tests in command/Path/Skill; missing/unknown handlers fail with `INVALID_HANDLER_BINDING`; no handler executes during compilation. |
| cli-canon.md §8.1b | A requested complete schema projection is checked before it is emitted; `compileProduct` does not claim every optional projection is complete before a caller requests one. | PROVEN | `public-contract.test.mjs`: unsupported complete schemas throw from `projectSchema`/`projectProductSchemas`; no unsupported schema is emitted as complete. |
| cli-canon.md §8.2 | Nested/optional/alias/repeat/`--`/placement/option-value grammar is admitted or rejected explicitly. | PROVEN | CMD-01–18. |
| cli-canon.md §8.3 | Isolated adapter maps parser/decode/domain/result/unexpected failures through CliIO/output policy. | PROVEN | OUT-01–07; runner and output tests. |
| cli-canon.md §8.4 | Skill invocation metadata derives route/usage/help and reports unbound required values as `requires-input`. | PROVEN | SKILL-02/04; `src/skill/projection.ts`; no shell-string reparse/executor is exposed. |
| cli-canon.md §9 | Path root/segments/parameters/kind and explicit context/precedence; cycle/traversal rejection; lexical aliases; no mutation/authorization. | PROVEN | PATH-01–09. |
| cli-canon.md §10.1a | Skill intent/steps/delegation/visibility and reference constraints. | PROVEN | SKILL-01–10. |
| cli-canon.md §10.1b | Product-specific `skill` runtime command wiring and the decision to add it during consumer migration. | NOT_APPLICABLE | This certifies framework projections only; no consumer CLI surface is migrated or given a new command. |
| cli-canon.md §10.2a | Encoding then exact UTF-8 budget then output response; valid JSON and required content are not truncated. | PROVEN | OUT-06–11; output policy and Skill tests. |
| cli-canon.md §10.2b | 4096-byte default Skill budget and minimum diagnostic-size tuning. | NOT_APPLICABLE | The design calls 4096 a starting point for consumer migration; Issue #15 requires shared explicit byte-budget behavior, not a default cap or product-specific budget choice. Certification makes no consumer default-budget claim. |
| cli-canon.md §11.1 | Shared scenario inputs can run against source/build/pack while product-specific fixture logic stays external. | PROVEN | `fixture-scenario.mjs`, runtime fixture test, package consumer. |
| cli-canon.md §11.2 | Expected behavior is independent and not auto-generated from the projector. | PROVEN | `fixture-oracle.mjs`; literal assertions in runtime tests. |
| cli-canon.md §11.3 | One exact packed artifact proves exports, types, import purity, runtime. | PROVEN | `test/package/consumer.mjs`; DIST-01–06. |
| cli-canon.md §12.1 | Required positive/negative types, construction, boundary, projections, output, paths, package proof. | PROVEN | `test/types/**`, detailed matrix rows, full verification. |
| cli-canon.md §12.2a | Backend corpus: route ordering, equals, aliases, repeat, optional value/positional, raw argv, surplus, option-looking values, ordered groups. | PROVEN | CMD-01–18; the two non-supported primitives have explicit construction errors. |
| cli-canon.md §12.2b | Mottainai's no-arguments server lifecycle and product-specific runtime boundary. | NOT_APPLICABLE | No Mottainai runtime or consumer is in this framework certification; CLI Canon does not own server lifecycle. |
| cli-canon.md §12.3 | Conformance claims are bounded to framework surface and known unsupported cases; no consumer is mislabeled migrated. | PROVEN | This matrix scope; no consumer migration/claim; CMD-16/17. |
| cli-canon.md §13.1–13.4 | Consumer rollout, adapters, migration rollback, and release/version policy. | NOT_APPLICABLE | Issue #15 stops before consumer migration/release; no consumer or release change is made. |
| cli-canon.md §13.2 / Wabachi blocker | Wabachi `architecture example` needs `--help[=full|json]`, option descriptions/examples, and progressive help from one Canon. | PROVEN | `contract.test.mjs`: “architecture example progressive help uses only the Command Canon” asserts independent exact root/domain/leaf/full text and JSON from one declaration. No Wabachi files changed. |
| cli-canon.md §14 | Excluded generic plugin, alternate schema/parser, domain engine, MCP/HTTP, and authorization features. | NOT_APPLICABLE | These are explicit non-goals, not missing requirements; no feature is added. Product boundaries are separately PROVEN at CANON §3 / C06. |
| cli-canon.md §15 | Implementation/certification evidence includes grammar, types, packed consumer, dependency lock. | PROVEN | This matrix, CMD/DIST, `pnpm-lock.yaml`, focused and full verification. |
| cli-canon.md §16 | Historical external citations and source-repository survey are not new framework behavior. | NOT_APPLICABLE | No re-audit of consumer repositories is authorized; Wabachi capability alone is assessed above. |

## Unsupported grammar remaining

Exactly two declared grammar forms remain unsupported by the current Commander backend:

1. Order-sensitive repeated option groups (`orderedOptionGroups`) — construction throws `UNSUPPORTED_GRAMMAR` (`CMD-17`).
2. `optionLookingValuePolicy: "reject"` — construction throws `UNSUPPORTED_GRAMMAR` (`CMD-16`).

M0's `optionLookingValuePolicy: "consume"` is supported and tested. This certification adds no parser and no fallback.

## Wabachi blocker result

**The previously identified framework blocker is cleared at the framework-contract level.** Current CLI Canon represents `--help[=full|json]`, root/domain/leaf progressive help, full help, command/positional/option descriptions, examples, usage, and JSON discovery from one compiled Command Canon. The independent expectations and runtime cases are in `contract.test.mjs`. This does not claim Wabachi has migrated or that its repository was modified.

## Production defects found and minimally corrected

1. **Failed invariant:** `cli-canon.md` §8.1 and CANON §5.2 / C02 require a command's execution binding to be validated before execution. **Observable failure:** `compileProduct` accepted a JavaScript caller's missing handler, and invocation later returned `UNEXPECTED: handler is not a function`. **Root cause:** handler coverage was enforced only by TypeScript's `HandlerMap`. **Minimal correction:** validate every declared command has an own function handler and reject unmatched extra handlers at construction with `INVALID_HANDLER_BINDING`.
2. **Failed invariant:** CANON §4.2 requires an immutable compiled representation whose runtime projections do not reread mutable authoring state. **Observable failure:** mutating the original input catalog after compilation changed the runtime decoder; mutating the original handler map changed which handler ran. **Root cause:** compiled commands and product retained authoring input/handler objects by reference. **Minimal correction:** snapshot and freeze command definitions/field records/arrays and the handler map at compilation. Zod schemas and handler functions remain the declared executable authorities; only their containing Canon records are snapshotted.
3. **Failed invariant:** Issue #15 and CANON §9 require declared pre-route options to work. **Observable failure:** a required `placement: "anywhere"` option was rejected as missing even when supplied before (or after) a nested route. **Root cause:** Commander enforced `makeOptionMandatory` independently on duplicated root and leaf option objects. **Minimal correction:** do not mark either duplicate mandatory; after parsing, validate combined root/local occurrences and return a usage failure if absent. Required option value parsing remains Commander-owned.

## Changes and verification record

Certification changes are limited to the three minimal production corrections above; focused proof for construction bindings, compiled snapshots, required pre-route options, explicit trailing required-option-value rejection, declaration-order-independent help/discovery ordering, a below-cap JSON assertion that rules out truncated success output, a lexical Path alias case, and this evidence matrix. No consumer repository, `.github/**`, or canonical architecture document changed.
