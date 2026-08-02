#!/usr/bin/env node

import { appendFile, readFile } from "node:fs/promises";

interface Arguments {
  metadataFile: string;
  githubOutput: string;
}

type Metadata = Record<string, unknown>;

const REQUIRED_FIELDS = [
  "version",
  "run-id",
  "artifact-id",
  "artifact-url",
  "artifact-digest",
] as const;

function printUsage(): void {
  console.error(
    "Usage: read-release-metadata.ts --metadata-file FILE --github-output FILE",
  );
}

function parseArguments(argv: string[]): Arguments {
  const values = new Map<string, string>();
  const supported = new Set(["--metadata-file", "--github-output"]);

  for (let index = 0; index < argv.length; index += 2) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (!supported.has(argument)) {
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

  const metadataFile = values.get("--metadata-file");
  const githubOutput = values.get("--github-output");
  if (!metadataFile || !githubOutput) {
    throw new Error("--metadata-file and --github-output are required");
  }
  return { metadataFile, githubOutput };
}

/**
 * Parse the flat, single-quoted object emitted by older release workflows.
 * This deliberately does not use eval or execute the metadata as JavaScript.
 */
function parseLegacyMetadata(contents: string): Metadata {
  const trimmed = contents.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new Error("Legacy metadata must be enclosed in braces");
  }

  let remaining = trimmed.slice(1, -1).trim();
  const metadata: Metadata = {};
  const entryPattern =
    /^'((?:\\.|[^'\\])*)'\s*:\s*'((?:\\.|[^'\\])*)'\s*(?:,\s*|$)/;

  while (remaining.length > 0) {
    const match = entryPattern.exec(remaining);
    if (!match) {
      throw new Error("Legacy metadata contains unsupported syntax");
    }
    const decode = (value: string): string =>
      value.replace(/\\(['\\])/g, "$1");
    metadata[decode(match[1])] = decode(match[2]);
    remaining = remaining.slice(match[0].length);
  }

  return metadata;
}

function parseMetadata(contents: string): Metadata {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents.replace(/^\uFEFF/, ""));
  } catch {
    parsed = parseLegacyMetadata(contents);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Release metadata must be an object");
  }
  return parsed as Metadata;
}

function readRequiredValues(metadata: Metadata): Record<string, string> {
  const output: Record<string, string> = {};
  const missing: string[] = [];

  for (const field of REQUIRED_FIELDS) {
    const value = metadata[field];
    if (
      (typeof value !== "string" && typeof value !== "number") ||
      String(value).length === 0
    ) {
      missing.push(field);
      continue;
    }
    const stringValue = String(value);
    if (/[\r\n]/.test(stringValue)) {
      throw new Error(`Release metadata field '${field}' contains a newline`);
    }
    output[field] = stringValue;
  }

  if (missing.length > 0) {
    throw new Error(
      `Release metadata is missing required fields: ${missing.join(", ")}`,
    );
  }
  return output;
}

async function main(): Promise<void> {
  const { metadataFile, githubOutput } = parseArguments(process.argv.slice(2));
  const contents = await readFile(metadataFile, "utf8");
  const values = readRequiredValues(parseMetadata(contents));
  const output = REQUIRED_FIELDS.map(
    (field) => `${field}=${values[field]}\n`,
  ).join("");
  await appendFile(githubOutput, output, "utf8");
  console.log(`Read release metadata from ${metadataFile}`);
}

main().catch((error: unknown) => {
  printUsage();
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
