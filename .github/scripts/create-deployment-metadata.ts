#!/usr/bin/env node

import { writeFile } from "node:fs/promises";

interface Arguments {
  tag: string;
  id: string;
  url: string;
  digest: string;
  outfile: string;
}

function printUsage(): void {
  console.error(
    "Usage: create-deployment-metadata.ts --tag TAG --id ID --url URL --digest DIGEST --outfile OUTFILE",
  );
}

function parseArguments(argv: string[]): Arguments {
  const supportedArguments = new Set([
    "--tag",
    "--id",
    "--url",
    "--digest",
    "--outfile",
  ]);
  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 2) {
    const argument = argv[index];
    const value = argv[index + 1];

    if (!supportedArguments.has(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }

    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`);
    }

    if (values.has(argument)) {
      throw new Error(`Argument provided more than once: ${argument}`);
    }

    values.set(argument, value);
  }

  const tag = values.get("--tag");
  const id = values.get("--id");
  const url = values.get("--url");
  const digest = values.get("--digest");
  const outfile = values.get("--outfile");

  if (!tag || !id || !url || !digest || !outfile) {
    throw new Error(
      "--tag, --id, --url, --digest, and --outfile are required",
    );
  }

  return { tag, id, url, digest, outfile };
}

async function main(): Promise<void> {
  const { tag, id, url, digest, outfile } = parseArguments(
    process.argv.slice(2),
  );
  const metadata = {
    version: tag,
    "artifact-id": id,
    "artifact-url": url,
    "artifact-digest": digest,
  };

  await writeFile(outfile, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  console.log(`Created deployment metadata at ${outfile}`);
}

main().catch((error: unknown) => {
  printUsage();
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
