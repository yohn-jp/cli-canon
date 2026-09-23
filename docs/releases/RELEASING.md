# Releasing CLI Canon

This document describes the npm release procedure for
`@yohn-jp/cli-canon`.

The synchronized wrapper at
[`.github/workflows/publish.yml`](../../.github/workflows/publish.yml) calls the
organization reusable npm publisher and is authoritative for automated release
behavior. This document is an operational summary, not a second workflow
authority.

## Release model

CLI Canon has one bootstrap exception:

- **0.1.0** is published manually from a verified packed tarball.
- **0.1.1 and later** are published through npm Trusted Publishing (OIDC) from
  a published GitHub Release.

The future automated path is:

```text
release PR merged to main
  -> GitHub Release vX.Y.Z targets the exact merge commit
  -> shared workflow checks tag == package.json version
  -> typecheck / test / build
  -> pack one exact tarball
  -> consumer release certification
  -> smoke-test the same tarball
  -> npm publish through OIDC Trusted Publishing
```

No long-lived npm token is part of the intended automated path.

## 0.1.0 bootstrap release

### 1. Merge the 0.1.0 release PR

The release PR must leave:

- `package.json` at `0.1.0`;
- `docs/releases/0.1.0.md` present;
- `pnpm run verify` green;
- the release certification and exact-tarball smoke scripts present.

Record the exact merge commit SHA on `main`.

### 2. Build and verify one tarball

From that exact commit:

```bash
pnpm install --frozen-lockfile
pnpm run verify

rm -f ./*.tgz
pnpm pack
```

There must be exactly one tarball.

Run the exact-artifact smoke test:

```bash
node scripts/smoke-test.mjs --tarball ./yohn-jp-cli-canon-0.1.0.tgz
```

Optionally run the release-certification script with the same artifact:

```bash
export RELEASE_SOURCE_SHA="<40-char-main-commit>"
export RELEASE_TAG="v0.1.0"
export RELEASE_ARTIFACT_PATH="$PWD/yohn-jp-cli-canon-0.1.0.tgz"
export RELEASE_ARTIFACT_SHA256="$(sha256sum "$RELEASE_ARTIFACT_PATH" | cut -d ' ' -f 1)"

node scripts/verify-release-certification.mjs
```

### 3. Publish 0.1.0 manually

Publish the already verified tarball, not a newly packed artifact:

```bash
npm publish ./yohn-jp-cli-canon-0.1.0.tgz --access public
```

Verify the registry result:

```bash
npm view @yohn-jp/cli-canon@0.1.0 version
npm view @yohn-jp/cli-canon@0.1.0 dist.tarball
```

Expected version:

```text
0.1.0
```

### 4. Create GitHub Release v0.1.0

Only after npm confirms 0.1.0:

```bash
gh release create v0.1.0 \
  --target <40-char-main-commit> \
  --title "CLI Canon 0.1.0" \
  --notes-file docs/releases/0.1.0.md
```

Publishing this GitHub Release triggers the synchronized publish workflow.

Because `@yohn-jp/cli-canon@0.1.0` is already on npm, the reusable publisher
will detect the existing version and skip the final `npm publish` action. The
build, pack, certification, and smoke stages still exercise the future release
path.

## Enable Trusted Publishing for subsequent releases

Before releasing 0.1.1 or any later version, configure npm Trusted Publishing
for this package so the GitHub Actions identity used by
`.github/workflows/publish.yml` may publish through OIDC.

The intended identity is:

```text
GitHub organization: yohn-jp
Repository:          cli-canon
Workflow:            .github/workflows/publish.yml
Environment:         npm
```

Do not add a long-lived npm automation token as a fallback.

## 0.1.1 and later

### 1. Prepare a normal release PR

Use a `release/X.Y.Z` branch.

The PR should:

- bump `package.json` to `X.Y.Z`;
- add `docs/releases/X.Y.Z.md`;
- update README or release documentation only when the public contract or
  release procedure changed;
- leave `pnpm run verify` green.

Merge the PR to `main`.

### 2. Publish the GitHub Release

Create a GitHub Release targeting the exact release merge commit:

```bash
gh release create vX.Y.Z \
  --target <40-char-main-commit> \
  --title "CLI Canon X.Y.Z" \
  --notes-file docs/releases/X.Y.Z.md
```

The published GitHub Release triggers the synchronized OIDC workflow.

Do **not** run a second manual `npm publish` for normal releases.

### 3. Verify publication

After the workflow succeeds:

```bash
npm view @yohn-jp/cli-canon@X.Y.Z version
```

For a consumer-level smoke test, install the exact version in an isolated
project and import all published subpaths:

```text
@yohn-jp/cli-canon
@yohn-jp/cli-canon/node
@yohn-jp/cli-canon/testing
```

## Failure handling

If the workflow fails before npm publication, fix the underlying problem on a
normal branch and release a corrected version. Do not weaken certification or
reuse a mutable artifact to force publication.

If npm already contains the target version, the shared publisher treats the
publish step as a no-op. npm versions are immutable; never attempt to replace a
published version with different bytes.

## Release contract

Every release must preserve these properties:

- the GitHub tag matches the package version;
- release notes correspond to that version;
- one exact tarball is built and certified;
- the same tarball is smoke-tested and published;
- root, Node, and testing exports are present;
- root import remains side-effect free;
- framework tests and packed consumer certification remain green.
