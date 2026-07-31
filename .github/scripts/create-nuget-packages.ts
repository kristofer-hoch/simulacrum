#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

import {
  Configurations,
  loadConfigurations,
} from "./deployment-config-service.ts";

interface Arguments {
  configDir: string;
  releaseVersion: string;
  projectDir: string;
}

const PACKAGE_AUTHOR = "kristofer.hoch@uipath.com";

function printUsage(): void {
  console.error(
    "Usage: create-nuget-packages.ts --config-dir CONFIG_DIR --release-version VERSION --project-dir PROJECT_DIR",
  );
}

function parseArguments(argv: string[]): Arguments {
  const supportedArguments = new Set([
    "--config-dir",
    "--release-version",
    "--project-dir",
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

  const configDir = values.get("--config-dir");
  const releaseVersion = values.get("--release-version");
  const projectDir = values.get("--project-dir");

  if (!configDir || !releaseVersion || !projectDir) {
    throw new Error(
      "--config-dir, --release-version, and --project-dir are required",
    );
  }

  return { configDir, releaseVersion, projectDir };
}

function runUipPack(
  packageId: string,
  packageVersion: string,
  packageDescription: string,
  projectDir: string,
  outputDir: string,
): Promise<void> {
  const uipArguments = [
    "pack",
    "--package-id",
    packageId,
    "--package-version",
    packageVersion,
    "--package-author",
    PACKAGE_AUTHOR,
    "--package-description",
    packageDescription,
    projectDir,
    outputDir,
  ];
  let executable = "uip";
  let arguments_ = uipArguments;

  // Node cannot spawn npm's .cmd shim directly on Windows. Invoke the
  // PowerShell shim as a script so descriptions and paths remain discrete
  // arguments instead of being interpolated into a shell command string.
  if (process.platform === "win32") {
    const searchPath = process.env.Path ?? process.env.PATH ?? "";
    const uipScript = searchPath
      .split(path.delimiter)
      .map((directory) => path.join(directory.replace(/^"|"$/g, ""), "uip.ps1"))
      .find(existsSync);

    if (!uipScript) {
      return Promise.reject(new Error("Unable to find uip.ps1 on PATH"));
    }

    executable = "powershell.exe";
    arguments_ = [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      uipScript,
      ...uipArguments,
    ];
  }

  return new Promise((resolve, reject) => {
    const child = spawn(executable, arguments_, { stdio: "inherit" });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      const reason = signal ? `signal ${signal}` : `exit code ${code}`;
      reject(new Error(`uip pack failed for ${packageId} with ${reason}`));
    });
  });
}

async function main(): Promise<void> {
  let arguments_: Arguments;

  try {
    arguments_ = parseArguments(process.argv.slice(2));
  } catch (error) {
    printUsage();
    throw error;
  }

  const configDir = path.resolve(arguments_.configDir);
  const projectDir = path.resolve(arguments_.projectDir);

  await loadConfigurations(configDir);

  for (const configuration of Configurations) {
    const outputDir = path.resolve(
      "dist",
      arguments_.releaseVersion,
      configuration.packageId,
    );

    await mkdir(outputDir, { recursive: true });
    console.log(
      `Packing ${configuration.packageId} v${arguments_.releaseVersion}`,
    );

    await runUipPack(
      configuration.packageId,
      arguments_.releaseVersion,
      configuration.description,
      projectDir,
      outputDir,
    );

    const deploymentConfigurationPath = path.join(
      configDir,
      `${configuration.packageId}.deploy.json`,
    );
    await copyFile(
      deploymentConfigurationPath,
      path.join(outputDir, path.basename(deploymentConfigurationPath)),
    );

    for (const asset of configuration.assets) {
      if (asset.valueFile) {
        const assetPath = path.resolve(asset.valueFile);
        await copyFile(assetPath, path.join(outputDir, path.basename(assetPath)));
      }
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
