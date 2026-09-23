# cli-canon

Read `.github/agent-governance/AGENTS.md` before working in this repository.

`@yohn-jp/cli-canon` is the shared TypeScript framework for authoring canonical CLI structure and deriving runtime/help/discovery projections.

## Canon

- Accepted Issues / Implementation contracts define task scope.
- `docs/architecture/CANON.md` is the normative architecture and ownership boundary.
- Consumer products retain their domain semantics; do not move product-specific behavior into CLI Canon.

## Validation

Full verification: `pnpm run verify`.
