# Security Policy

## Supported Versions

CLI Canon is pre-1.0 (`0.x`). There is no long-term support branch yet.
Security fixes land on `main` and the latest `0.x` release.

| Version    | Supported |
| ---------- | --------- |
| latest 0.x | Yes       |

## Reporting a Vulnerability

Report suspected vulnerabilities privately through this repository's GitHub
Security Advisories rather than opening a public Issue.

If that path is unavailable, open an Issue containing no sensitive exploit
detail and request private maintainer follow-up.

Include, where possible:

- a description of the issue and impact;
- a minimal reproduction;
- the affected package version or commit;
- whether the issue affects the root, `./node`, or `./testing` package
  surface.

Reports are handled on a best-effort basis by the project maintainers.

## Trust boundaries

CLI Canon is a library for describing and projecting CLI contracts. It does
not own product authorization, product lifecycle decisions, provider
credentials, filesystem ownership, or transport authority.

The root package is designed to be side-effect free. Commander is isolated to
the `@yohn-jp/cli-canon/node` adapter. Path Canon resolves lexical addresses;
it does not grant permission or mutate the filesystem. Invocation Canon
produces structured `{ executable, argv }` values and does not construct or
execute shell command strings.

Machine JSON output fails explicitly for unsupported values and byte-budget
violations rather than truncating a document. Unsupported CLI grammar fails at
construction rather than falling through to an alternate parser.

Consumer products remain responsible for validating their own domain inputs,
authorization, state transitions, credentials, filesystem operations, and
external side effects.

## Dependencies and release artifacts

Runtime/parser and schema boundaries are intentionally narrow. Changes to the
parser or schema backend require explicit architecture review rather than an
implicit fallback.

Published releases are expected to pass the repository verification and exact
packed-artifact certification described in
[docs/releases/RELEASING.md](docs/releases/RELEASING.md).
