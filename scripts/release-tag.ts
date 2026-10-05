#!/usr/bin/env node
// The npm dist-tag a published GitHub release goes out under, or a refusal when the release does
// not add up. The release workflow runs it under plain Node, which strips the types itself, before
// anything is published:
//
//   node scripts/release-tag.ts <tag> <package version> <prerelease>
//
// It prints the dist-tag and, when GITHUB_OUTPUT is set, appends `tag=<dist-tag>` to it. A release
// that does not add up exits 1 with the reason; a missing argument exits 2.
import { appendFileSync } from "node:fs";

import { runsAsScript } from "./entry-point.ts";

export type ReleaseChannel = "alpha" | "beta" | "rc";
export type ReleaseDistTag = "latest" | ReleaseChannel;

export type ReleaseFacts = {
  /** The Git tag the release points at, for example `v1.2.0-rc.1`. */
  readonly tag: string;
  /** `version` from the package.json at that tag. */
  readonly version: string;
  /** GitHub's "Set as a pre-release" flag on the release. */
  readonly prerelease: boolean;
};

/** A release that must not be published. The message says what to fix. */
export class ReleaseTagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReleaseTagError";
  }
}

const RELEASE_TAG_USAGE =
  "usage: node scripts/release-tag.ts <tag> <package version> <prerelease>\n" +
  "  <prerelease> is GitHub's release flag, true or false.\n";

// X.Y.Z or X.Y.Z-(alpha|beta|rc).N, without leading zeros, build metadata, or any other suffix.
const VERSION =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(alpha|beta|rc)\.(?:0|[1-9]\d*))?$/;
const ARTICLE: Readonly<Record<ReleaseChannel, string>> = { alpha: "an", beta: "a", rc: "an" };

/**
 * `latest` only for a plain X.Y.Z on a release that is not a pre-release; the channel name for a
 * suffixed version on a pre-release. Every other combination is refused, so a pre-release can
 * never become `latest`.
 */
export function releaseDistTag({ tag, version, prerelease }: ReleaseFacts): ReleaseDistTag {
  const match = VERSION.exec(version);
  if (match === null) {
    throw new ReleaseTagError(
      `package.json version ${JSON.stringify(version)} is neither X.Y.Z nor X.Y.Z-(alpha|beta|rc).N`,
    );
  }
  if (tag !== `v${version}`) {
    throw new ReleaseTagError(
      `tag ${tag} does not match package.json version ${version}: expected v${version}`,
    );
  }
  const channel = match[1] as ReleaseChannel | undefined;
  if (channel === undefined) {
    if (prerelease) {
      throw new ReleaseTagError(
        `${tag} is a stable version, but the GitHub release is marked as a pre-release`,
      );
    }
    return "latest";
  }
  if (!prerelease) {
    throw new ReleaseTagError(
      `${tag} is ${ARTICLE[channel]} ${channel} version, but the GitHub release is not marked as a pre-release`,
    );
  }
  return channel;
}

/** GitHub writes the flag as `true` or `false`; anything else is a broken workflow, not a guess. */
export function prereleaseFlagFrom(raw: string | undefined): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new ReleaseTagError(
    `the prerelease flag must be true or false, not ${JSON.stringify(raw ?? null)}`,
  );
}

function main(
  argv: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): number {
  if (argv.length !== 3) {
    process.stderr.write(RELEASE_TAG_USAGE);
    return 2;
  }
  const [tag = "", version = "", flag] = argv;
  try {
    const distTag = releaseDistTag({ tag, version, prerelease: prereleaseFlagFrom(flag) });
    const output = environment.GITHUB_OUTPUT;
    if (output !== undefined && output !== "") appendFileSync(output, `tag=${distTag}\n`);
    process.stdout.write(`${distTag}\n`);
    return 0;
  } catch (error) {
    if (!(error instanceof ReleaseTagError)) throw error;
    process.stderr.write(`release-tag: ${error.message}\n`);
    return 1;
  }
}

if (runsAsScript(import.meta.main)) process.exit(main(process.argv.slice(2), process.env));
