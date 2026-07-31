#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

// File names are case-sensitive on Linux runners, so match the repository
// convention exactly.
const CONFIGURATION_FILE_NAME = "Configuration.json";
const INSIGHTS_DATA_MAP_FILE_NAME = "InsightsDataMap.json";

/** Command-line inputs accepted by this generator. */
interface Arguments {
  configDir: string;
  outputDir: string;
  globalConfig: string;
}

/** Category hierarchy used to construct an Orchestrator folder path. */
interface CategoryPath {
  category_1: string;
  category_2?: string;
  category_3?: string;
}

/** Input-schema fields that can be mapped to UiPath Insights custom fields. */
interface InputField {
  name: string;
  type: string;
  description?: string;
}

/**
 * Subset of Configuration.json consumed by deployment generation.
 * The source document may contain additional properties.
 */
interface Configuration {
  automation: {
    automation_name: string;
    process_id: string | number;
    description: string;
    category_path: CategoryPath;
    execution_model: {
      classification: string;
    };
  };
  input_schema?: {
    fields?: InputField[];
  };
}

/** Shape of a generated InsightsDataMap.json file. */
interface InsightsDataMap {
  string: Record<string, string>;
  number: Record<string, string>;
  datetime: Record<string, string>;
  zipcode: Record<string, string>;
}

/** One Orchestrator process declared in a deployment configuration. */
interface ProcessDefinition {
  name: string;
  description: string;
  entryPoint: string;
}

/**
 * Assets may contain an inline value (global assets) or a valueFile
 * (automation-specific assets). Additional deployment properties are
 * preserved when copied from the global configuration.
 */
interface DeploymentAsset {
  name: string;
  description: string;
  type: string;
  value?: unknown;
  valueFile?: string;
  [property: string]: unknown;
}

/** Shared deployment settings loaded once from --global-config. */
interface GlobalConfiguration {
  assets: DeploymentAsset[];
}

/** Shape written to each Simulacrum.<name>.<process-id>.deploy.json file. */
interface DeploymentConfiguration {
  folder: string;
  description: string;
  packageFeed: string;
  packageId: string;
  assets: DeploymentAsset[];
  queue?: {
    name: string;
    description: string;
  };
  processes: ProcessDefinition[];
}

/** Print the supported invocation without hiding the validation error. */
function printUsage(): void {
  console.error(
    "Usage: generate-deployment-configurations.ts --config-dir CONFIG_DIR --output-dir OUTPUT_DIR --global-config GLOBAL_CONFIG",
  );
}

/**
 * Parse strict flag/value pairs. Rejecting unknown or duplicate flags catches
 * CI configuration mistakes instead of silently generating the wrong output.
 */
function parseArguments(argv: string[]): Arguments {
  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (
      argument !== "--config-dir" &&
      argument !== "--output-dir" &&
      argument !== "--global-config"
    ) {
      throw new Error(`Unknown argument: ${argument}`);
    }

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`);
    }

    if (values.has(argument)) {
      throw new Error(`Argument provided more than once: ${argument}`);
    }

    values.set(argument, value);
    index += 1;
  }

  const configDir = values.get("--config-dir");
  const outputDir = values.get("--output-dir");
  const globalConfig = values.get("--global-config");

  if (!configDir || !outputDir || !globalConfig) {
    throw new Error(
      "--config-dir, --output-dir, and --global-config are required",
    );
  }

  return { configDir, outputDir, globalConfig };
}

/**
 * Load and validate the shared assets before any automation files are created.
 * Asset objects are retained as authored so deployment-specific properties
 * beyond the standard name, description, type, and value are not discarded.
 */
async function loadGlobalConfiguration(
  globalConfigPath: string,
): Promise<GlobalConfiguration> {
  let parsedGlobalConfig: unknown;

  try {
    const contents = await readFile(globalConfigPath, "utf8");
    parsedGlobalConfig = JSON.parse(contents.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(
      `Unable to parse global configuration ${globalConfigPath}: ${(error as Error).message}`,
    );
  }

  if (!parsedGlobalConfig || typeof parsedGlobalConfig !== "object") {
    throw new Error(
      `Invalid global configuration ${globalConfigPath}: root must be a JSON object`,
    );
  }

  const assets = (parsedGlobalConfig as { assets?: unknown }).assets;
  if (!Array.isArray(assets)) {
    throw new Error(
      `Invalid global configuration ${globalConfigPath}: assets must be an array`,
    );
  }

  for (const [index, asset] of assets.entries()) {
    if (!asset || typeof asset !== "object" || Array.isArray(asset)) {
      throw new Error(
        `Invalid global configuration ${globalConfigPath}: assets[${index}] must be a JSON object`,
      );
    }
  }

  return { assets: assets as DeploymentAsset[] };
}

/** Recursively discover Configuration.json files in deterministic order. */
async function findConfigurationFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const configurationFiles: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      configurationFiles.push(...(await findConfigurationFiles(entryPath)));
    } else if (entry.isFile() && entry.name === CONFIGURATION_FILE_NAME) {
      configurationFiles.push(entryPath);
    }
  }

  return configurationFiles.sort((left, right) => left.localeCompare(right));
}

/** Validate a required string and retain its original, untrimmed value. */
function requireNonEmptyString(value: unknown, propertyName: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${propertyName} must be a non-empty string`);
  }

  return value;
}

/**
 * Validate the source properties required to build deployment resources.
 * Returning the narrowed type keeps the generation functions type-safe.
 */
function validateConfiguration(value: unknown): Configuration {
  if (!value || typeof value !== "object") {
    throw new Error("Configuration root must be a JSON object");
  }

  const configuration = value as Partial<Configuration>;
  const automation = configuration.automation;

  if (!automation || typeof automation !== "object") {
    throw new Error("automation must be a JSON object");
  }

  requireNonEmptyString(automation.automation_name, "automation.automation_name");
  requireNonEmptyString(automation.description, "automation.description");
  requireNonEmptyString(
    automation.execution_model?.classification,
    "automation.execution_model.classification",
  );
  requireNonEmptyString(
    automation.category_path?.category_1,
    "automation.category_path.category_1",
  );

  if (
    (typeof automation.process_id !== "string" &&
      typeof automation.process_id !== "number") ||
    String(automation.process_id).trim() === ""
  ) {
    throw new Error("automation.process_id must be a non-empty string or number");
  }

  if (
    configuration.input_schema?.fields !== undefined &&
    !Array.isArray(configuration.input_schema.fields)
  ) {
    throw new Error("input_schema.fields must be an array when provided");
  }

  return configuration as Configuration;
}

/** Normalize generated paths so JSON remains portable across Windows and Linux. */
function toPortablePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

/**
 * Asset valueFile paths are stored relative to the repository working
 * directory, which is also the expected working directory in CI.
 */
function repositoryRelativePath(filePath: string): string {
  return toPortablePath(path.relative(process.cwd(), filePath));
}

/**
 * A third-level category is valid only when its parent category is present.
 * This mirrors the hierarchy rules in Configuration.json.
 */
function buildOrchestratorFolder(categoryPath: CategoryPath): string {
  const categories = [categoryPath.category_1];

  if (categoryPath.category_2) {
    categories.push(categoryPath.category_2);

    if (categoryPath.category_3) {
      categories.push(categoryPath.category_3);
    }
  }

  return categories.join("/");
}

/**
 * Build common assets and then select the process topology from the execution
 * model: queue + dispatcher/performer for transactional automations, or a
 * single bot process for every other classification.
 */
function buildDeploymentConfiguration(
  configuration: Configuration,
  configurationPath: string,
  insightsDataMapPath: string,
  globalAssets: DeploymentAsset[],
): DeploymentConfiguration {
  const automation = configuration.automation;
  const processName = automation.automation_name;
  const processNameNormalized = processName.replaceAll(" ", "");

  const deployment: DeploymentConfiguration = {
    folder: `${buildOrchestratorFolder(automation.category_path)}/${processName}`,
    description: automation.description,
    // Top-level automation categories double as Orchestrator package feeds.
    packageFeed: automation.category_path.category_1,
    packageId: `Simulacrum.${processNameNormalized}`,
    assets: [
      {
        name: "Configuration",
        description: "Automation configuration JSON",
        type: "Text",
        valueFile: repositoryRelativePath(configurationPath),
      },
      {
        name: "InsightsDataMap",
        description: "Maps source fields to UiPath Insights custom fields.",
        type: "Text",
        valueFile: repositoryRelativePath(insightsDataMapPath),
      },
      // Global assets follow local assets and retain their authored properties.
      ...globalAssets,
    ],
    processes: [],
  };

  if (automation.execution_model.classification === "transactional") {
    deployment.queue = {
      name: processNameNormalized,
      description: `Queue for the ${processName} dispatcher and performers`,
    };
    deployment.processes = [
      {
        name: `${processName} Dispatcher`,
        description: `Dispatcher for ${automation.description}`,
        entryPoint: "ep_Dispatcher.cs",
      },
      {
        name: `${processName} Performer`,
        description: `Performer for ${automation.description}`,
        entryPoint: "ep_Performer.cs",
      },
    ];
  } else {
    deployment.processes = [
      {
        name: `${processName} Bot`,
        description: automation.description,
        entryPoint: "ep_SingleJob.cs",
      },
    ];
  }

  return deployment;
}

/** Identify common postal/ZIP-code wording without requiring an exact phrase. */
function isPostalCodeDescription(description: string | undefined): boolean {
  return /\b(?:postal\s*code|post\s*code|postcode|zip(?:\s*code)?)\b/i.test(
    description ?? "",
  );
}

/**
 * Allocate custom variables independently within each Insights data type.
 * Unsupported input types are intentionally omitted from the generated map.
 */
function buildInsightsDataMap(fields: InputField[]): InsightsDataMap {
  const insightsDataMap: InsightsDataMap = {
    string: {},
    number: {},
    datetime: {},
    zipcode: {},
  };
  const counters = {
    string: 0,
    number: 0,
    datetime: 0,
    zipcode: 0,
  };

  for (const field of fields) {
    const fieldName = requireNonEmptyString(field.name, "input_schema.fields[].name");
    const fieldType = requireNonEmptyString(
      field.type,
      `input_schema.fields[${fieldName}].type`,
    ).toLowerCase();

    let mapType: keyof InsightsDataMap | undefined;
    let customVariableType: string | undefined;

    if (fieldType === "string" && isPostalCodeDescription(field.description)) {
      mapType = "zipcode";
      customVariableType = "ZipCode";
    } else if (fieldType === "string") {
      mapType = "string";
      customVariableType = "String";
    } else if (fieldType === "number") {
      mapType = "number";
      customVariableType = "Number";
    } else if (fieldType === "datetime") {
      mapType = "datetime";
      customVariableType = "DateTime";
    }

    if (mapType && customVariableType) {
      counters[mapType] += 1;
      const sequence = String(counters[mapType]).padStart(3, "0");
      insightsDataMap[mapType][fieldName] =
        `CustomVariable${customVariableType}${sequence}`;
    }
  }

  return insightsDataMap;
}

/** Test for an existing file while allowing other file-system errors to surface. */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

/**
 * Generate all artifacts associated with one source configuration.
 * Existing Insights maps are preserved because they may contain curated
 * mappings; only a missing map is derived from input_schema.fields.
 */
async function processConfiguration(
  configurationPath: string,
  outputDir: string,
  globalAssets: DeploymentAsset[],
): Promise<string> {
  let parsedConfiguration: unknown;

  try {
    const contents = await readFile(configurationPath, "utf8");
    // PowerShell-produced JSON in this repository may start with a UTF-8 BOM.
    parsedConfiguration = JSON.parse(contents.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(
      `Unable to parse ${configurationPath}: ${(error as Error).message}`,
    );
  }

  let configuration: Configuration;
  try {
    configuration = validateConfiguration(parsedConfiguration);
  } catch (error) {
    throw new Error(
      `Invalid configuration ${configurationPath}: ${(error as Error).message}`,
    );
  }

  const insightsDataMapPath = path.join(
    path.dirname(configurationPath),
    INSIGHTS_DATA_MAP_FILE_NAME,
  );

  if (!(await fileExists(insightsDataMapPath))) {
    const fields = configuration.input_schema?.fields ?? [];
    const insightsDataMap = buildInsightsDataMap(fields);
    await writeFile(
      insightsDataMapPath,
      `${JSON.stringify(insightsDataMap, null, 2)}\n`,
      "utf8",
    );
  }

  const deployment = buildDeploymentConfiguration(
    configuration,
    configurationPath,
    insightsDataMapPath,
    globalAssets,
  );
  const processNameNormalized =
    configuration.automation.automation_name.replaceAll(" ", "");
  const deploymentFileName =
    `Simulacrum.${processNameNormalized}.deploy.json`;
  const deploymentPath = path.join(outputDir, deploymentFileName);

  await writeFile(
    deploymentPath,
    `${JSON.stringify(deployment, null, 2)}\n`,
    "utf8",
  );

  return deploymentPath;
}

/** Coordinate argument parsing, discovery, output creation, and generation. */
async function main(): Promise<void> {
  let arguments_: Arguments;

  try {
    arguments_ = parseArguments(process.argv.slice(2));
  } catch (error) {
    printUsage();
    throw error;
  }

  const configDir = path.resolve(arguments_.configDir);
  const outputDir = path.resolve(arguments_.outputDir);
  const globalConfigPath = path.resolve(arguments_.globalConfig);

  // Load GCONFIG before discovery or output creation so an invalid global
  // configuration cannot leave behind partially generated deployment files.
  const globalConfiguration =
    await loadGlobalConfiguration(globalConfigPath);
  const configurationFiles = await findConfigurationFiles(configDir);

  await mkdir(outputDir, { recursive: true });

  for (const configurationFile of configurationFiles) {
    const deploymentPath = await processConfiguration(
      configurationFile,
      outputDir,
      globalConfiguration.assets,
    );
    console.log(`Created ${deploymentPath}`);
  }

  console.log(
    `Generated ${configurationFiles.length} deployment configuration(s).`,
  );
}

// Keep failures visible to both local callers and CI through a non-zero exit.
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
