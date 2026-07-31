#!/usr/bin/env node

import { appendFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

/** Format a date as YYYY.MM.DD.HHMMSS using the runner's local time. */
function formatReleaseTag(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`,
  ].join(".");
}

/** Run a Git command and preserve its output in the workflow log. */
function runGit(arguments_: string[]): void {
  const result = spawnSync("git", arguments_, {
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `git ${arguments_.join(" ")} failed with exit code ${result.status}`,
    );
  }
}

async function main(): Promise<void> {
  const githubEnvPath = process.env.GITHUB_ENV;

  if (!githubEnvPath) {
    throw new Error(
      "GITHUB_ENV is not set. Run this script from a GitHub Actions step.",
    );
  }

  const releaseTag = formatReleaseTag(new Date());

  await appendFile(githubEnvPath, `RELEASE_TAG=${releaseTag}\n`, "utf8");
  console.log(`Set RELEASE_TAG=${releaseTag}`);

  runGit(["tag", releaseTag]);
  runGit(["push", "origin", releaseTag]);

  console.log(`Created and pushed Git tag ${releaseTag}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
