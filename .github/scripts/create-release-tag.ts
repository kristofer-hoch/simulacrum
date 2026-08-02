#!/usr/bin/env node

import { appendFile } from "node:fs/promises";

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
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
