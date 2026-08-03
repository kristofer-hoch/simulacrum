#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

type JsonObject = Record<string, unknown>;

interface DeploymentAsset extends JsonObject {
  name: string;
  description?: string;
  type?: string;
  scope?: string;
  value?: unknown;
  valueFile?: string;
  credentialStoreKey?: string;
}

interface DeploymentProcess extends JsonObject {
  name: string;
  description?: string;
  entryPoint: string;
}

interface DeploymentQueue extends JsonObject {
  name: string;
  description?: string;
}

interface DeploymentManifest extends JsonObject {
  folder: string;
  description?: string;
  packageFeed?: string;
  packageId: string;
  packageVersion?: string;
  assets: DeploymentAsset[];
  processes: DeploymentProcess[];
  queue?: DeploymentQueue;
}

interface UipInvocation {
  executable: string;
  arguments: string[];
}

interface Arguments {
  workingDirectory: string;
  configPath: string;
}

interface LoginConfiguration {
  authority: string;
  organization: string;
  tenant: string;
  clientId: string;
  clientSecret: string;
}

function printUsage(): void {
  console.error(
    "Usage: deploy-orchestrator.ts WORKING_DIRECTORY --config CONFIGJSON",
  );
  console.error();
  console.error(
    "Recursively finds *.deploy.json manifests in the working directory,",
  );
  console.error("then applies them to UiPath Orchestrator in sorted order.");
}

function parseArguments(argv: string[]): Arguments {
  let workingDirectory: string | undefined;
  let configPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--config") {
      if (configPath !== undefined) {
        throw new Error("--config may only be provided once");
      }
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--config requires a CONFIGJSON file path");
      }
      configPath = value;
      index += 1;
      continue;
    }

    if (argument.startsWith("--")) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    if (workingDirectory !== undefined) {
      throw new Error("Exactly one WORKING_DIRECTORY is required");
    }
    workingDirectory = argument;
  }

  if (!workingDirectory || !configPath) {
    throw new Error("WORKING_DIRECTORY and --config CONFIGJSON are required");
  }
  return { workingDirectory, configPath };
}

function log(message: string): void {
  console.log(`[deploy] ${message}`);
}

function requireNonEmptyString(value: unknown, property: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${property} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, property: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return requireNonEmptyString(value, property);
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateManifest(value: unknown, manifestPath: string): DeploymentManifest {
  if (!isObject(value)) {
    throw new Error(`Invalid manifest ${manifestPath}: root must be a JSON object`);
  }

  const folder = requireNonEmptyString(value.folder, "folder");
  const packageId = requireNonEmptyString(value.packageId, "packageId");
  const description = optionalString(value.description, "description");
  const packageFeed = optionalString(value.packageFeed, "packageFeed");
  const packageVersion = optionalString(value.packageVersion, "packageVersion");

  if (!Array.isArray(value.assets)) {
    throw new Error(`Invalid manifest ${manifestPath}: assets must be an array`);
  }
  const assets = value.assets.map((asset, index): DeploymentAsset => {
    if (!isObject(asset)) {
      throw new Error(`assets[${index}] must be an object`);
    }
    return {
      ...asset,
      name: requireNonEmptyString(asset.name, `assets[${index}].name`),
      description: optionalString(
        asset.description,
        `assets[${index}].description`,
      ),
      type: optionalString(asset.type, `assets[${index}].type`),
      scope: optionalString(asset.scope, `assets[${index}].scope`),
      valueFile: optionalString(
        asset.valueFile,
        `assets[${index}].valueFile`,
      ),
      credentialStoreKey: optionalString(
        asset.credentialStoreKey,
        `assets[${index}].credentialStoreKey`,
      ),
    };
  });

  if (!Array.isArray(value.processes)) {
    throw new Error(`Invalid manifest ${manifestPath}: processes must be an array`);
  }
  const processes = value.processes.map(
    (process, index): DeploymentProcess => {
      if (!isObject(process)) {
        throw new Error(`processes[${index}] must be an object`);
      }
      return {
        ...process,
        name: requireNonEmptyString(process.name, `processes[${index}].name`),
        description: optionalString(
          process.description,
          `processes[${index}].description`,
        ),
        entryPoint: requireNonEmptyString(
          process.entryPoint,
          `processes[${index}].entryPoint`,
        ),
      };
    },
  );

  let queue: DeploymentQueue | undefined;
  if (value.queue !== undefined && value.queue !== null) {
    if (!isObject(value.queue)) {
      throw new Error("queue must be an object when provided");
    }
    queue = {
      ...value.queue,
      name: requireNonEmptyString(value.queue.name, "queue.name"),
      description: optionalString(value.queue.description, "queue.description"),
    };
  }

  return {
    ...value,
    folder,
    description,
    packageFeed,
    packageId,
    packageVersion,
    assets,
    processes,
    queue,
  };
}

function validateLoginConfiguration(
  value: unknown,
  configPath: string,
): LoginConfiguration {
  if (!isObject(value)) {
    throw new Error(`Invalid login config ${configPath}: root must be a JSON object`);
  }

  return {
    authority: requireNonEmptyString(value.authority, "authority"),
    organization: requireNonEmptyString(value.organization, "organization"),
    tenant: requireNonEmptyString(value.tenant, "tenant"),
    clientId: requireNonEmptyString(value["client-id"], "client-id"),
    clientSecret: requireNonEmptyString(
      value["client-secret"],
      "client-secret",
    ),
  };
}

async function loadLoginConfiguration(
  configPath: string,
): Promise<LoginConfiguration> {
  let parsed: unknown;
  try {
    const contents = await readFile(configPath, "utf8");
    parsed = JSON.parse(contents.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(
      `Unable to parse login config ${configPath}: ${(error as Error).message}`,
    );
  }
  return validateLoginConfiguration(parsed, configPath);
}

function findUipInvocation(uipArguments: string[]): UipInvocation {
  if (process.platform !== "win32") {
    return { executable: "uip", arguments: uipArguments };
  }

  const searchPath = process.env.Path ?? process.env.PATH ?? "";
  const uipScript = searchPath
    .split(path.delimiter)
    .map((directory) => path.join(directory.replace(/^"|"$/g, ""), "uip.ps1"))
    .find(existsSync);

  if (!uipScript) {
    throw new Error("Unable to find uip.ps1 on PATH");
  }

  return {
    executable: "powershell.exe",
    arguments: [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      uipScript,
      ...uipArguments,
    ],
  };
}

function redactUipArguments(uipArguments: string[]): string[] {
  return uipArguments.map((argument, index) =>
    index > 0 && uipArguments[index - 1] === "--client-secret"
      ? "<redacted>"
      : argument,
  );
}

function redactSensitiveText(text: string, uipArguments: string[]): string {
  const secretIndex = uipArguments.indexOf("--client-secret");
  const secret = secretIndex >= 0 ? uipArguments[secretIndex + 1] : undefined;
  return secret ? text.split(secret).join("<redacted>") : text;
}

function runUip(uipArguments: string[]): Promise<string> {
  const invocation = findUipInvocation(uipArguments);

  return new Promise((resolve, reject) => {
    const child = spawn(invocation.executable, invocation.arguments, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      const details = redactSensitiveText(
        stderr.trim() || stdout.trim() || `exit code ${code}`,
        uipArguments,
      );
      const safeArguments = redactUipArguments(uipArguments);
      reject(new Error(`uip ${safeArguments.join(" ")} failed: ${details}`));
    });
  });
}

async function uipJson(...uipArguments: string[]): Promise<JsonObject> {
  const output = await runUip([...uipArguments, "--output", "json"]);
  try {
    const parsed: unknown = JSON.parse(output.trim());
    if (!isObject(parsed)) {
      throw new Error("response root is not an object");
    }
    const operation =
      uipArguments[0] === "login"
        ? "login"
        : uipArguments.slice(0, 3).join(" ");
    const result = parsed.Code ?? parsed.code ?? parsed.Result ?? parsed.result;
    console.log(
      `[uip] ${operation} completed${typeof result === "string" ? ` (${result})` : ""}`,
    );
    return parsed;
  } catch (error) {
    const safeArguments = redactUipArguments(uipArguments);
    throw new Error(
      `Unable to parse JSON from 'uip ${safeArguments.join(" ")}': ${(error as Error).message}`,
    );
  }
}

function dataItems(response: JsonObject): JsonObject[] {
  const data = response.Data ?? response.data ?? response;
  return Array.isArray(data) ? data.filter(isObject) : [];
}

function exactNamedItem(
  response: JsonObject,
  name: string,
): JsonObject | undefined {
  return dataItems(response).find((item) => (item.Name ?? item.name) === name);
}

function stringField(item: JsonObject, ...fields: string[]): string | undefined {
  for (const field of fields) {
    const value = item[field];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

async function resolveInputFile(
  reference: string,
  workingDirectory: string,
): Promise<string> {
  const candidates = path.isAbsolute(reference)
    ? [reference]
    : [
        path.resolve(workingDirectory, reference),
        path.resolve(workingDirectory, path.basename(reference)),
      ];

  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) {
        return candidate;
      }
    } catch {
      // Try the next supported resolution location.
    }
  }
  throw new Error(`Referenced input file was not found: ${reference}`);
}

async function login(config: LoginConfiguration): Promise<void> {
  log("Logging into UiPath with client credentials");
  await uipJson(
    "login",
    "--authority",
    config.authority,
    "--organization",
    config.organization,
    "--tenant",
    config.tenant,
    "--client-id",
    config.clientId,
    "--client-secret",
    config.clientSecret,
  );

  const refreshedStatus = await uipJson("login", "status");
  const refreshedData = isObject(refreshedStatus.Data)
    ? refreshedStatus.Data
    : isObject(refreshedStatus.data)
      ? refreshedStatus.data
      : {};
  if ((refreshedData.Status ?? refreshedData.status) !== "Logged in") {
    throw new Error("UiPath login did not complete successfully");
  }
}

async function ensureFolderPath(manifest: DeploymentManifest): Promise<void> {
  const parts = manifest.folder.split("/");
  if (parts.some((part) => part.length === 0)) {
    throw new Error(`Folder path contains an empty segment: ${manifest.folder}`);
  }

  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    try {
      await uipJson("or", "folders", "get", current);
      log(`Folder exists: ${current}`);
      continue;
    } catch {
      const createArguments = ["or", "folders", "create", part];
      if (current.includes("/")) {
        createArguments.push("--parent", current.slice(0, current.lastIndexOf("/")));
      } else if (manifest.packageFeed && part === manifest.packageFeed) {
        createArguments.push("--feed-type", "FolderHierarchy");
      }
      if (current === manifest.folder && manifest.description) {
        createArguments.push("--description", manifest.description);
      }
      log(`Creating folder: ${current}`);
      await uipJson(...createArguments);
    }
  }
}

async function ensureAssets(
  manifest: DeploymentManifest,
  workingDirectory: string,
): Promise<void> {
  for (const asset of manifest.assets) {
    const listed = await uipJson(
      "or",
      "assets",
      "list",
      "--folder-path",
      manifest.folder,
      "--name",
      asset.name,
      "--limit",
      "100",
    );
    if (exactNamedItem(listed, asset.name)) {
      log(`Asset exists: ${asset.name}`);
      continue;
    }

    let value: string;
    if (Object.hasOwn(asset, "value")) {
      if (typeof asset.value === "string") {
        value = asset.value;
      } else {
        const serializedValue = JSON.stringify(asset.value);
        if (serializedValue === undefined) {
          throw new Error(`Asset '${asset.name}' has an unsupported value`);
        }
        value = serializedValue;
      }
    } else if (asset.valueFile) {
      const valueFile = await resolveInputFile(asset.valueFile, workingDirectory);
      value = await readFile(valueFile, "utf8");
    } else {
      throw new Error(`Asset '${asset.name}' must define value or valueFile`);
    }

    const createArguments = [
      "or",
      "assets",
      "create",
      asset.name,
      value,
      "--folder-path",
      manifest.folder,
      "--type",
      asset.type ?? "Text",
      "--scope",
      asset.scope ?? "Global",
    ];
    if (asset.description) {
      createArguments.push("--description", asset.description);
    }
    if (asset.credentialStoreKey) {
      createArguments.push(
        "--credential-store-key",
        asset.credentialStoreKey,
      );
    }
    log(`Creating asset: ${asset.name}`);
    await uipJson(...createArguments);
  }
}

async function ensureQueue(manifest: DeploymentManifest): Promise<void> {
  const queue = manifest.queue;
  if (!queue) {
    return;
  }

  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const listed = await uipJson(
      "or",
      "queues",
      "list",
      "--folder-path",
      manifest.folder,
      "--limit",
      String(pageSize),
      "--offset",
      String(offset),
    );
    const queues = dataItems(listed);
    if (queues.some((item) => (item.Name ?? item.name) === queue.name)) {
      log(`Queue exists: ${queue.name}`);
      return;
    }
    if (queues.length < pageSize) {
      break;
    }
  }

  const createArguments = [
    "or",
    "queues",
    "create",
    queue.name,
    "--folder-path",
    manifest.folder,
  ];
  if (queue.description) {
    createArguments.push("--description", queue.description);
  }
  log(`Creating queue: ${queue.name}`);
  await uipJson(...createArguments);
}

async function resolveFeedArguments(
  packageFeed: string | undefined,
): Promise<string[]> {
  if (!packageFeed) {
    return [];
  }
  return ["--folder-path", packageFeed];
}

async function ensurePackage(
  manifest: DeploymentManifest,
  packageFile: string,
  packageVersion: string,
  feedArguments: string[],
): Promise<void> {
  const versions = await uipJson(
    "or",
    "packages",
    "versions",
    manifest.packageId,
    "--limit",
    "100",
    ...feedArguments,
  );
  const exists = dataItems(versions).some(
    (item) => (item.Version ?? item.version) === packageVersion,
  );
  if (exists) {
    log(`Package exists: ${manifest.packageId}:${packageVersion}`);
    return;
  }

  log(`Uploading package: ${manifest.packageId}:${packageVersion}`);
  await uipJson(
    "or",
    "packages",
    "upload",
    packageFile,
    ...feedArguments,
  );
}

async function ensureProcesses(
  manifest: DeploymentManifest,
  packageVersion: string,
): Promise<void> {
  for (const processDefinition of manifest.processes) {
    const listed = await uipJson(
      "or",
      "processes",
      "list",
      "--folder-path",
      manifest.folder,
      "--name",
      processDefinition.name,
      "--limit",
      "100",
    );
    const existing = exactNamedItem(listed, processDefinition.name);

    if (!existing) {
      const createArguments = [
        "or",
        "processes",
        "create",
        "--folder-path",
        manifest.folder,
        "--name",
        processDefinition.name,
        "--package-key",
        manifest.packageId,
        "--package-version",
        packageVersion,
        "--entry-point",
        processDefinition.entryPoint,
      ];
      if (processDefinition.description) {
        createArguments.push("--description", processDefinition.description);
      }
      log(`Creating process: ${processDefinition.name}`);
      await uipJson(...createArguments);
      continue;
    }

    const processKey = stringField(existing, "Key", "key");
    if (!processKey) {
      throw new Error(`Existing process '${processDefinition.name}' has no key`);
    }
    const existingPackageId = stringField(
      existing,
      "ProcessKey",
      "processKey",
      "PackageId",
      "packageId",
    );
    const existingVersion = stringField(
      existing,
      "ProcessVersion",
      "processVersion",
      "Version",
      "version",
    );
    if (existingPackageId && existingPackageId !== manifest.packageId) {
      throw new Error(
        `Process '${processDefinition.name}' is bound to package '${existingPackageId}', not '${manifest.packageId}'`,
      );
    }

    if (existingVersion !== packageVersion) {
      log(`Upgrading process: ${processDefinition.name} -> ${packageVersion}`);
      await uipJson(
        "or",
        "processes",
        "update-version",
        processKey,
        "--package-version",
        packageVersion,
        "--folder-path",
        manifest.folder,
      );
    } else {
      log(`Process version is current: ${processDefinition.name}`);
    }
  }
}

async function discoverDeploymentManifests(
  workingDirectory: string,
): Promise<string[]> {
  const manifests: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(".deploy.json")) {
        manifests.push(entryPath);
      }
    }
  }

  await visit(workingDirectory);
  manifests.sort();
  return manifests;
}

async function findPackageForManifest(
  manifestPath: string,
  packageId: string,
): Promise<string> {
  const manifestDirectory = path.dirname(manifestPath);
  const expectedPrefix = `${packageId}.`;
  const entries = await readdir(manifestDirectory, { withFileTypes: true });
  const matchingPackages = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith(expectedPrefix) &&
        entry.name.endsWith(".nupkg"),
    )
    .map((entry) => path.join(manifestDirectory, entry.name))
    .sort();

  if (matchingPackages.length !== 1) {
    throw new Error(
      `Expected one ${packageId}.*.nupkg beside '${manifestPath}'; found ${matchingPackages.length}`,
    );
  }
  return matchingPackages[0];
}

async function loadDeploymentManifest(
  manifestPath: string,
): Promise<DeploymentManifest> {
  let parsedManifest: unknown;
  try {
    const contents = await readFile(manifestPath, "utf8");
    parsedManifest = JSON.parse(contents.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(
      `Unable to parse deployment manifest ${manifestPath}: ${(error as Error).message}`,
    );
  }
  return validateManifest(parsedManifest, manifestPath);
}

async function processDeployment(manifestPath: string): Promise<void> {
  const manifest = await loadDeploymentManifest(manifestPath);
  const packagePath = await findPackageForManifest(
    manifestPath,
    manifest.packageId,
  );
  const manifestDirectory = path.dirname(manifestPath);
  log(`Using package: ${path.basename(packagePath)}`);

  const packageFileName = path.basename(packagePath);
  const expectedPrefix = `${manifest.packageId}.`;
  const fileVersion = packageFileName.slice(
    expectedPrefix.length,
    -".nupkg".length,
  );
  if (!fileVersion) {
    throw new Error(`Unable to derive package version from ${packageFileName}`);
  }
  if (manifest.packageVersion && manifest.packageVersion !== fileVersion) {
    throw new Error(
      `Manifest packageVersion '${manifest.packageVersion}' does not match package filename version '${fileVersion}'`,
    );
  }
  const packageVersion = manifest.packageVersion ?? fileVersion;

  await ensureFolderPath(manifest);
  await ensureAssets(manifest, manifestDirectory);
  await ensureQueue(manifest);
  const feedArguments = await resolveFeedArguments(manifest.packageFeed);
  await ensurePackage(manifest, packagePath, packageVersion, feedArguments);
  await ensureProcesses(manifest, packageVersion);

  log(
    `Deployment complete: ${manifest.packageId}:${packageVersion} in ${manifest.folder}`,
  );
}

async function main(): Promise<void> {
  let arguments_: Arguments;
  try {
    arguments_ = parseArguments(process.argv.slice(2));
  } catch (error) {
    printUsage();
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[deploy] ERROR: ${message}`);
    process.exitCode = 2;
    return;
  }

  const workingDirectory = path.resolve(arguments_.workingDirectory);
  const configPath = path.resolve(arguments_.configPath);
  let directoryStats;
  try {
    directoryStats = await stat(workingDirectory);
  } catch {
    throw new Error(`Working directory not found: ${workingDirectory}`);
  }
  if (!directoryStats.isDirectory()) {
    throw new Error(`Working directory is not a directory: ${workingDirectory}`);
  }

  const loginConfiguration = await loadLoginConfiguration(configPath);
  await login(loginConfiguration);

  log(`Searching for *.deploy.json files in ${workingDirectory}`);
  const manifestPaths = await discoverDeploymentManifests(workingDirectory);
  if (manifestPaths.length === 0) {
    throw new Error(
      `No *.deploy.json files were found in working directory '${workingDirectory}'`,
    );
  }
  log(`Found ${manifestPaths.length} deployment manifest(s)`);

  for (const [index, manifestPath] of manifestPaths.entries()) {
    const relativePath = path.relative(workingDirectory, manifestPath);
    log(`[${index + 1}/${manifestPaths.length}] Processing ${relativePath}`);
    await processDeployment(manifestPath);
  }

  log(`Processed ${manifestPaths.length} deployment manifest(s) successfully`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[deploy] ERROR: ${message}`);
  process.exitCode = 1;
});
