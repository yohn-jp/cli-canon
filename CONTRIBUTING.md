# Contributing

Thanks for your interest in contributing. CLI Canon is pre-1.0; public
contracts may evolve between minor versions until 1.0.

## Before you start

- Open one concrete Issue before implementation.
- Include the Issue number in the branch name:
  `<type>/<issue-number>-<slug>`, where `<type>` is one of
  `feat`, `fix`, `docs`, `refactor`, `test`, or `chore`.
- Keep a pull request scoped to one closing Issue.
- Treat `docs/architecture/CANON.md` and
  `docs/architecture/cli-canon.md` as the architecture authorities.

## Development setup

Requires Node.js 24 or newer and pnpm 11.18.0.

```bash
pnpm install --frozen-lockfile
pnpm run verify
```

`pnpm run verify` runs the repository's type, build, runtime, and exact
packed-package gates and is the authoritative local verification entry point.

## Making changes

1. Create a branch from current `main` using the Issue number.
2. Keep the change bounded to the Issue contract.
3. Add or update only the tests required to prove the changed contract.
4. Preserve the Canon ownership boundaries; do not duplicate command, Skill,
   Path, output, or package facts in a second table.
5. Run `pnpm run verify`.
6. Update README or release documentation when the public contract changes.

## Architecture boundaries

CLI Canon owns generic CLI structure and projections. Product-domain
authorization, lifecycle/state-machine decisions, provider behavior,
filesystem safety, transport authority, and product-owned domain schemas stay
outside this repository.

Unsupported grammar must fail explicitly. Do not introduce a hidden fallback
parser or shell-string execution path to emulate an unsupported contract.

## Generated output

`dist/**` is TypeScript build output and is not committed. The npm package
builds it during `prepack`.

Do not commit generated package tarballs.

## Commit messages

Use Conventional Commit subjects such as `feat:`, `fix:`, `docs:`,
`refactor:`, `test:`, and `chore:`.

## Pull requests

- Describe the contract changed and why.
- Link the closing Issue.
- Keep the repository pull request template sections intact.
- Complete every required validation checklist truthfully.
- CI, Governance, and CodeQL must pass before merge.
- Do not combine unrelated refactors with a contract change.

## Reporting bugs and requesting features

Use GitHub Issues for normal bugs and feature requests.

For suspected security vulnerabilities, follow [SECURITY.md](SECURITY.md)
instead of opening a public vulnerability report.
