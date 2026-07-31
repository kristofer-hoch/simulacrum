#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** An Orchestrator asset declared by a deployment configuration. */
export interface DeploymentAsset {
  name: string;
  description: string;
  type: string;
  value?: unknown;
  valueFile?: string;
  [property: string]: unknown;
}

/** An Orchestrator process declared by a deployment configuration. */
export interface DeploymentProcess {
  name: string;
  description: string;
  entryPoint: string;
}

/** An optional Orchestrator queue declared by a deployment configuration. */
export interface DeploymentQueue {
  name: string;
  description: string;
}

/**
 * Runtime model for a *.deploy.json file.
 *
 * The queue is optional because not every automation uses a transactional
 * execution model.
 */
export class DeploymentConfigurationModel {
  folder: string;
  description: string;
  packageFeed: string;
  packageId: string;
  assets: DeploymentAsset[];
  processes: DeploymentProcess[];
  queue?: DeploymentQueue;

  constructor(configuration: {
    folder: string;
    description: string;
    packageFeed: string;
    packageId: string;
    assets: DeploymentAsset[];
    processes: DeploymentProcess[];
    queue?: DeploymentQueue;
  }) {
    this.folder = configuration.folder;
    this.description = configuration.description;
    this.packageFeed = configuration.packageFeed;
    this.packageId = configuration.packageId;
    this.assets = configuration.assets;
    this.processes = configuration.processes;
    this.queue = configuration.queue;
  }

  static from(value: unknown, source: string): DeploymentConfigurationModel {
    if (!isRecord(value)) {
      throw new Error(`Invalid deployment configuration ${source}: root must be an object`);
    }

    const folder = requireString(value, "folder", source);
    const description = requireString(value, "description", source);
    const packageFeed = requireString(value, "packageFeed", source);
    const packageId = requireString(value, "packageId", source);
    const assets = requireObjectArray(value, "assets", source).map(
      (asset, index): DeploymentAsset => ({
        ...asset,
        name: requireString(asset, "name", `${source}: assets[${index}]`),
        description: requireString(
          asset,
          "description",
          `${source}: assets[${index}]`,
        ),
        type: requireString(asset, "type", `${source}: assets[${index}]`),
        ...optionalStringProperty(
          asset,
          "valueFile",
          `${source}: assets[${index}]`,
        ),
      }),
    );
    const processes = requireObjectArray(value, "processes", source).map(
      (process, index): DeploymentProcess => ({
        name: requireString(process, "name", `${source}: processes[${index}]`),
        description: requireString(
          process,
          "description",
          `${source}: processes[${index}]`,
        ),
        entryPoint: requireString(
          process,
          "entryPoint",
          `${source}: processes[${index}]`,
        ),
      }),
    );

    let queue: DeploymentQueue | undefined;
    if (value.queue !== undefined) {
      if (!isRecord(value.queue)) {
        throw new Error(
          `Invalid deployment configuration ${source}: queue must be an object`,
        );
      }

      queue = {
        name: requireString(value.queue, "name", `${source}: queue`),
        description: requireString(
          value.queue,
          "description",
          `${source}: queue`,
        ),
      };
    }

    return new DeploymentConfigurationModel({
      folder,
      description,
      packageFeed,
      packageId,
      assets,
      processes,
      queue,
    });
  }
}

export const Configurations: Array<DeploymentConfigurationModel> = [];
export const PackageFeeds: Array<string> = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(
  object: Record<string, unknown>,
  property: string,
  source: string,
): string {
  const value = object[property];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `Invalid deployment configuration ${source}: ${property} must be a non-empty string`,
    );
  }

  return value;
}

function optionalStringProperty(
  object: Record<string, unknown>,
  property: string,
  source: string,
): Record<string, string> {
  const value = object[property];
  if (value === undefined) {
    return {};
  }

  if (typeof value !== "string") {
    throw new Error(
      `Invalid deployment configuration ${source}: ${property} must be a string`,
    );
  }

  return { [property]: value };
}

function requireObjectArray(
  object: Record<string, unknown>,
  property: string,
  source: string,
): Array<Record<string, unknown>> {
  const value = object[property];
  if (!Array.isArray(value) || !value.every(isRecord)) {
    throw new Error(
      `Invalid deployment configuration ${source}: ${property} must be an array of objects`,
    );
  }

  return value;
}

function parseConfigDirectory(argv: string[]): string {
  if (argv.length !== 2 || argv[0] !== "--config-dir") {
    throw new Error(
      "Usage: deployment-config-service.ts --config-dir CONFIG_DIR",
    );
  }

  const configDir = argv[1];
  if (!configDir || configDir.startsWith("--")) {
    throw new Error("Missing value for --config-dir");
  }

  return path.resolve(configDir);
}

export async function loadConfigurations(configDir: string): Promise<void> {
  Configurations.length = 0;
  PackageFeeds.length = 0;

  let entries;

  try {
    entries = await readdir(configDir, { withFileTypes: true });
  } catch (error) {
    throw new Error(
      `Unable to read configuration directory ${configDir}: ${(error as Error).message}`,
    );
  }

  const deploymentFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".deploy.json"))
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const deploymentFile of deploymentFiles) {
    const deploymentPath = path.join(configDir, deploymentFile.name);
    let parsed: unknown;

    try {
      const contents = await readFile(deploymentPath, "utf8");
      parsed = JSON.parse(contents.replace(/^\uFEFF/, ""));
    } catch (error) {
      throw new Error(
        `Unable to parse deployment configuration ${deploymentPath}: ${(error as Error).message}`,
      );
    }

    const configuration = DeploymentConfigurationModel.from(
      parsed,
      deploymentPath,
    );
    Configurations.push(configuration);

    if (!PackageFeeds.includes(configuration.packageFeed)) {
      PackageFeeds.push(configuration.packageFeed);
    }
  }
}

const isMainModule =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  await loadConfigurations(parseConfigDirectory(process.argv.slice(2)));
}
