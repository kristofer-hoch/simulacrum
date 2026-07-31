# Simulacrum deployment

This directory contains the source configuration and deployment metadata used
to provision Simulacrum automations in UiPath Orchestrator.

The deployment flow is configuration-driven:

1. An automation author adds or updates a `Configuration.json`.
2. The deployment generator loads the shared assets from
   `global.deploy.json`.
3. The generator discovers every automation configuration recursively.
4. A missing `InsightsDataMap.json` is derived from the input schema.
5. One `Simulacrum.<ProcessNameNormalized>.<ProcessId>.deploy.json` file is
   generated for each automation, including both automation-specific and
   global assets.
6. The deployment pipeline builds or publishes the corresponding Simulacrum
   package and applies the generated automation deployment files to
   Orchestrator.
7. The deployed resources are verified in the target Orchestrator folder.

## Repository layout

```text
.github/
├── deployment/
│   ├── README.md
│   ├── global.deploy.json
│   └── configs/
│       └── <category 1>/<category 2>/<automation>/
│           ├── Configuration.json
│           └── InsightsDataMap.json
├── scripts/
│   └── generate-deployment-configurations.ts
└── workflows/
    └── cicd-pipeline.yml
```

- `configs/` is the deployment source of truth for individual automations.
- `global.deploy.json` defines shared assets copied into every automation
  deployment.
- `generate-deployment-configurations.ts` creates per-automation deployment
  files.
- `cicd-pipeline.yml` contains the GitHub Actions entry point.

## Prerequisites

- Node.js with direct TypeScript execution support. Node.js 24 is known to work
  with the current script.
- The UiPath CLI and the `@uipath/orchestrator-tool` and `@uipath/rpa-tool`
  tools for the publish/deploy stages.
- Access to the target UiPath organization, tenant, package feed, and
  Orchestrator folders.
- Run commands from the repository root. Generated `valueFile` paths are
  relative to the current working directory.

## Authoring an automation configuration

Place each automation in its own directory under `configs/`. The generator
consumes the following properties:

```json
{
  "automation": {
    "automation_name": "Customer Health Escalation Monitor",
    "process_id": "36",
    "description": "Monitor customer health indicators.",
    "category_path": {
      "category_1": "Client Success",
      "category_2": "Customer Success Management",
      "category_3": ""
    },
    "execution_model": {
      "classification": "transactional"
    }
  },
  "input_schema": {
    "fields": [
      {
        "name": "submitted_at",
        "type": "datetime",
        "description": "Timestamp when the record was submitted."
      }
    ]
  }
}
```

Required deployment properties are:

- `automation.automation_name`
- `automation.process_id`
- `automation.description`
- `automation.category_path.category_1`
- `automation.execution_model.classification`

`category_2` and `category_3` are optional. `category_3` is used only when
`category_2` also has a value. The process name is appended to the category
hierarchy, and the resulting Orchestrator folder uses `/` as the separator:

```text
<category 1>/<category 2>/<category 3>/<process name>
```

## Generate deployment files

Run:

```powershell
node .github/scripts/generate-deployment-configurations.ts `
  --config-dir .github/deployment/configs `
  --output-dir .github/deployment/generated `
  --global-config .github/deployment/global.deploy.json
```

The equivalent single-line command works in Bash:

```bash
node .github/scripts/generate-deployment-configurations.ts --config-dir .github/deployment/configs --output-dir .github/deployment/generated --global-config .github/deployment/global.deploy.json
```

All three arguments are required:

- `--config-dir` is recursively searched for files named exactly
  `Configuration.json`.
- `--output-dir` is created when necessary and receives all generated
  `*.deploy.json` files.
- `--global-config` identifies the JSON file whose `assets` array is copied
  into every generated deployment.

Generation is deterministic. Invalid JSON, missing required properties,
unknown arguments, and file-system errors stop the script with a non-zero exit
code.

## Generated deployment resources

The automation name has literal spaces removed when used in identifiers and
filenames. For example:

```text
Customer Health Escalation Monitor
└── Simulacrum.CustomerHealthEscalationMonitor.36.deploy.json
```

Every deployment file defines:

- The Orchestrator folder derived from `category_path`, with the original
  process name appended.
- The package feed from `automation.category_path.category_1`.
- A package ID in the form `Simulacrum.<ProcessNameNormalized>`.
- `Configuration` and `InsightsDataMap` text assets whose values come from
  their JSON files.
- Every asset from the `assets` array in the file passed to
  `--global-config`.

Global assets are appended after the `Configuration` and `InsightsDataMap`
assets, in their original order. Their JSON properties are preserved. The
script stops before creating output files if the global configuration is
missing, invalid JSON, or does not contain an `assets` array.

### Transactional execution

When `automation.execution_model.classification` is exactly `transactional`,
the generated deployment includes:

- One queue named `<ProcessNameNormalized>`.
- A `<ProcessName> Dispatcher` process using `ep_Dispatcher.cs`.
- A `<ProcessName> Performer` process using `ep_Performer.cs`.

### Non-transactional execution

Every other classification generates one `<ProcessName> Bot` process using
`ep_SingleJob.cs`.

## Insights data maps

If an automation directory does not contain `InsightsDataMap.json`, the
generator creates one from `input_schema.fields`. An existing file is never
overwritten, allowing mappings to be curated manually.

Supported source types are:

| Input field | Insights map | Generated value |
| --- | --- | --- |
| `string` | `string` | `CustomVariableString001` |
| `string` with a postal/ZIP-code description | `zipcode` | `CustomVariableZipCode001` |
| `number` | `number` | `CustomVariableNumber001` |
| `datetime` | `datetime` | `CustomVariableDateTime001` |

Numbering starts at `001` independently for each map type and follows the field
order in `Configuration.json`. Unsupported types are omitted. Postal detection
is case-insensitive and recognizes common terms such as `postal code`,
`postcode`, `post code`, `ZIP`, and `ZIP code`.

Review newly generated maps before deployment. Renaming or reordering fields
can change generated assignments if the existing map is deleted.

## Environment-specific values

The generator sets each deployment's package feed to
`automation.category_path.category_1`. Confirm that every top-level category
matches a package feed available in the target Orchestrator environment. Do not
commit credentials or tenant secrets into a deployment JSON file.

The GitHub Actions workflow references these settings:

| Setting | Purpose |
| --- | --- |
| `NODE_VERSION` | Node.js version used by the runner |
| `UIPATH_CLI_VERSION` | UiPath CLI version to install |
| `UIPATH_AUTHORITY` | UiPath identity authority |
| `UIPATH_ORGANIZATION` | Target organization |
| `UIPATH_TENANT_NAME` | Target tenant |
| `UIPATH_CLIENT_ID` | External application client ID |
| `UIPATH_CLIENT_SECRET` | External application client secret |

Store the client secret as a GitHub Actions environment secret. Store
non-sensitive, environment-specific settings as environment variables or
repository/environment variables, then map them into the workflow's `env`
block.

## CI/CD sequence

A complete CI/CD job should perform these stages in order:

1. Check out the repository.
2. Set up the configured Node.js version.
3. Install the pinned UiPath CLI version.
4. Install the Orchestrator and RPA CLI tools.
5. Authenticate to the target UiPath organization and tenant.
6. Run the deployment generator.
7. Build and publish the Simulacrum RPA package for each generated package ID.
8. Apply each generated `*.deploy.json`, which already includes the global
   assets.
9. Verify folders, assets, queues, processes, entry points, and package
    versions in Orchestrator.

At present, `.github/workflows/cicd-pipeline.yml` only contains part of the
bootstrap/authentication work. It does not invoke the generator, publish
packages, apply deployment JSON, or verify the result. Those stages must be
added before the workflow represents a complete automated deployment.

## Validation checklist

Before merging configuration changes:

- Run the generator locally and confirm it exits successfully.
- Confirm every expected automation has one generated deployment file.
- Confirm generated filenames are unique.
- Review folder paths and package IDs.
- Review new Insights mappings for type and numbering correctness.
- Confirm the global assets appear in every generated deployment.
- Confirm transactional automations have a queue and two processes.
- Confirm non-transactional automations have one bot process.
- Confirm the CI environment provides all required variables and secrets.
- Confirm each top-level category identifies a valid target package feed.

After deployment:

- Verify each automation folder contains the shared `DataAgentFolder` and
  `DataAgentName` assets from `global.deploy.json`.
- Verify each automation's `Configuration` and `InsightsDataMap` text assets.
- Verify queues exist only for transactional automations.
- Verify process entry points and package versions.
- Run a smoke test for both a single-job and transactional automation.

## Troubleshooting

### The script reports an unknown or missing argument

Pass each flag once and provide its value as the following argument. The
`--config-dir=value` form is not supported.

### The global configuration is rejected

Confirm the `--global-config` path exists, contains valid JSON, and has an
`assets` array. Every entry in that array must be a JSON object.

### A configuration cannot be parsed

Validate that the file contains one JSON object. UTF-8 files with or without a
byte-order mark are supported.

### An expected field is absent from InsightsDataMap.json

Only `string`, `number`, and `datetime` input types are mapped. A string is
mapped as a ZIP code only when its description indicates a postal or ZIP code.
If the map already existed, generation preserves it unchanged.

### Asset files cannot be found during deployment

Run the generator from the repository root and ensure the deployment command
uses the same checkout as its working directory. Asset paths use forward
slashes so the generated JSON works on Windows and Linux runners.

### A generated deployment uses the wrong package feed

Confirm `automation.category_path.category_1` contains the intended package
feed name and that the feed exists in the target Orchestrator environment.
