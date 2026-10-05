# Releasing @ogarciarevett/jev-sdk

Publishing a GitHub Release publishes the package. You choose the version and the channel; [`.github/workflows/release.yml`](.github/workflows/release.yml) checks that the release adds up, tests the tagged commit, and publishes that same commit to npm and to GitHub Packages. Nobody runs `npm publish` by hand.

## Quick path

1. On a branch, set the version and merge it to `main` through a pull request:

   ```sh
   npm version 1.2.0 --no-git-tag-version
   git commit -am "chore(release): 1.2.0"
   ```

2. Tag the merged commit on `main` and push the tag:

   ```sh
   git switch main && git pull
   git tag v1.2.0
   git push origin v1.2.0
   ```

3. Publish a GitHub Release for that tag. Leave "Set as a pre-release" unchecked for a stable version:

   ```sh
   gh release create v1.2.0 --title v1.2.0 --generate-notes
   ```

4. Watch the Release workflow in the Actions tab, then confirm: `npm view @ogarciarevett/jev-sdk dist-tags`.

## Channels

The version decides the dist-tag, and the GitHub pre-release box must agree with it.

| Channel | `package.json` version | Tag | Pre-release box | Dist-tag | `gh` flag |
| --- | --- | --- | --- | --- | --- |
| Stable | `1.2.0` | `v1.2.0` | unchecked | `latest` | none |
| Release candidate | `1.2.0-rc.1` | `v1.2.0-rc.1` | checked | `rc` | `--prerelease` |
| Beta | `1.2.0-beta.1` | `v1.2.0-beta.1` | checked | `beta` | `--prerelease` |
| Alpha | `1.2.0-alpha.1` | `v1.2.0-alpha.1` | checked | `alpha` | `--prerelease` |

`N` in `-rc.N`, `-beta.N`, and `-alpha.N` is a whole number without leading zeros. Any other suffix, such as `-next.1`, or build metadata such as `+build.1`, is refused. A pre-release can never become `latest`.

## What the workflow does

| Job | Does | Stops when |
| --- | --- | --- |
| `verify` | Checks out the tag, records its commit, resolves the dist-tag (`scripts/release-tag.ts`), then runs the typecheck, the build, and the tests with the Node smoke test required. | The tag is not `v<package.json version>`, the version has an unsupported shape, the pre-release box disagrees with the version, or any check fails. |
| `npm` | Checks out the verified commit, skips if npm already has the version, otherwise runs `npm publish --access public --provenance --tag <dist-tag>`. | The tag moved after verification, npm 11.5.1 or newer is missing, the registry check gets any error other than "not found", or it gives no clear `true` or `false` answer. |
| `github-packages` | The same against `https://npm.pkg.github.com`, with the workflow's `GITHUB_TOKEN`. | The same. |

- npm authenticates with trusted publishing: npm exchanges the workflow's OIDC token for a short-lived publish token, so no npm token is stored once the bootstrap below is done. Every npm release carries a provenance attestation.
- The registry check is `scripts/registry-version.ts`. Only npm's "not found" (`E404`) counts as absent; an authentication, permission, or network error fails the job instead of publishing on a guess.
- Forks never publish. One release publishes at a time: a release published while another runs waits. GitHub keeps only one waiting run, so if a third release arrives, the waiting one is cancelled and does not publish until you re-run it by hand from the Actions tab.

## When a release is refused

Nothing was published if `verify` failed. Fix the cause, then publish again:

| Problem | Fix |
| --- | --- |
| Wrong tag, or the version in `package.json` is wrong | `gh release delete v1.2.0 --cleanup-tag --yes`, fix the version on `main`, then tag and release again. |
| Pre-release box does not match the version | `gh release delete v1.2.0 --yes` (keeps the tag), then `gh release create` again with or without `--prerelease`. Editing the box on an existing release does not start the workflow. |
| A check failed on the tagged commit | Delete the release and the tag as in the first row, fix the code on `main`, and tag the fixed commit. The version was never published, so it can be reused. |

## Recover from a partial publish

If one registry has the version and the other job failed (an outage, a token problem), fix the cause and use "Re-run all jobs" (or "Re-run failed jobs") on the same workflow run. Each publish job checks out the verified commit and skips a registry that already has the version, so a re-run publishes only what is missing. Do not bump the version just to retry.

## First publish: one-time bootstrap

Trusted publishing is configured per package on npmjs.com, so the very first version goes out with a short-lived token instead.

1. Sign in to npmjs.com as `ogarciarevett`, the owner of the `@ogarciarevett` scope.
2. Create a granular access token: permission "Read and write (publish and stage)", limited to the `@ogarciarevett` scope, with the shortest expiration available. Check "Bypass two-factor authentication": a workflow cannot answer a 2FA prompt.
3. Store it as the repository secret `NPM_TOKEN` without putting it on a command line: `gh secret set NPM_TOKEN --repo ogarciarevett/jev-sdk` reads it from a prompt.
4. Publish the first release (for example `v0.1.0`, stable) with the quick path above. npm falls back to `NPM_TOKEN` because no trusted publisher exists yet.
5. On npmjs.com, open the package's settings, find "Trusted Publisher", choose GitHub Actions, and enter: organization or user `ogarciarevett`, repository `jev-sdk`, workflow filename `release.yml`, no environment.
6. Delete the secret (`gh secret delete NPM_TOKEN --repo ogarciarevett/jev-sdk`) and revoke the token on npmjs.com. Every later release uses trusted publishing; if `NPM_TOKEN` were still set, OIDC would win anyway.
7. Recommended by npm: in the package's settings, under "Publishing access", choose "Require two-factor authentication and disallow tokens".

GitHub Packages needs no bootstrap: the first publish with `GITHUB_TOKEN` creates the package, and the `repository` field in `package.json` links it to this repository.

## Move a dist-tag or deprecate a version

These run from your machine with an interactive `npm login`, not from the workflow:

```sh
# Point latest back at an earlier version, or drop a channel tag.
npm dist-tag add @ogarciarevett/jev-sdk@1.2.1 latest
npm dist-tag rm @ogarciarevett/jev-sdk rc

# Warn anyone installing a version, and undo the warning with an empty message.
npm deprecate @ogarciarevett/jev-sdk@1.2.0 "Use 1.2.1: <reason>"
npm deprecate @ogarciarevett/jev-sdk@1.2.0 ""
```

Prefer deprecation to unpublishing: npm limits unpublishing (see [npm's unpublish policy](https://docs.npmjs.com/policies/unpublish)), and a version number can never be reused. The GitHub Packages mirror gets its dist-tags when a version is published; npm is the source of truth for channels.

## Installing from GitHub Packages

GitHub Packages requires authentication even for public packages: a personal access token (classic) with `read:packages`, or `GITHUB_TOKEN` inside a workflow whose repository has read access to the package. In the consumer's `.npmrc`, with the token in the environment rather than in the file:

```ini
@ogarciarevett:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}
```
