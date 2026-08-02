#!/usr/bin/env bash

set -Eeuo pipefail

usage() {
  printf '%s\n' \
    'Usage: deploy-orchestrator.sh WORKING_DIRECTORY' \
    '' \
    'Finds one *.deploy.json manifest and one *.nupkg package in the working' \
    'directory, then applies the deployment to UiPath Orchestrator.'
}

log() {
  printf '[deploy] %s\n' "$*" >&2
}

die() {
  printf '[deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

if (($# != 1)); then
  usage >&2
  exit 2
fi

WORKING_DIRECTORY="$1"
command -v uip >/dev/null 2>&1 || die "uip is not installed or is not on PATH"
command -v jq >/dev/null 2>&1 || die "jq is required to parse JSON"
[[ -d "$WORKING_DIRECTORY" ]] || die "working directory not found: $WORKING_DIRECTORY"

WORKING_DIRECTORY="$(cd "$WORKING_DIRECTORY" && pwd)"
MANIFEST_DIR="$WORKING_DIRECTORY"
BASE_DIR="$WORKING_DIRECTORY"

shopt -s nullglob
DEPLOY_MANIFEST_CANDIDATES=("$WORKING_DIRECTORY"/*.deploy.json)
PACKAGE_CANDIDATES=("$WORKING_DIRECTORY"/*.nupkg)
shopt -u nullglob

if ((${#DEPLOY_MANIFEST_CANDIDATES[@]} == 0)); then
  shopt -s nullglob
  JSON_CANDIDATES=("$WORKING_DIRECTORY"/*.json)
  shopt -u nullglob
  ((${#JSON_CANDIDATES[@]} == 1)) || \
    die "expected one *.deploy.json file in '$WORKING_DIRECTORY'; found none and found ${#JSON_CANDIDATES[@]} other JSON files"
  JSON_FILE="${JSON_CANDIDATES[0]}"
elif ((${#DEPLOY_MANIFEST_CANDIDATES[@]} == 1)); then
  JSON_FILE="${DEPLOY_MANIFEST_CANDIDATES[0]}"
else
  die "expected one *.deploy.json file in '$WORKING_DIRECTORY'; found ${#DEPLOY_MANIFEST_CANDIDATES[@]}"
fi

((${#PACKAGE_CANDIDATES[@]} == 1)) || \
  die "expected one *.nupkg file in '$WORKING_DIRECTORY'; found ${#PACKAGE_CANDIDATES[@]}"
PACKAGE_FILE="${PACKAGE_CANDIDATES[0]}"

log "Using deployment manifest: $(basename "$JSON_FILE")"
log "Using package: $(basename "$PACKAGE_FILE")"

# Read the complete deployment manifest into memory once.
DEPLOYMENT_JSON="$(<"$JSON_FILE")"
jq -e '
  type == "object" and
  (.folder | type == "string" and length > 0) and
  (.packageId | type == "string" and length > 0) and
  ((.assets // []) | type == "array") and
  ((.processes // []) | type == "array") and
  ((.queue == null) or (.queue | type == "object"))
' <<<"$DEPLOYMENT_JSON" >/dev/null || die "manifest is invalid or is missing required fields"

uip_json() {
  uip "$@" --output json
}

data_has_exact_name() {
  local json="$1"
  local name="$2"
  jq -e --arg name "$name" '
    (.Data // .data // .) as $items |
    ($items | type) == "array" and
    any($items[]; (.Name // .name // "") == $name)
  ' <<<"$json" >/dev/null
}

item_field_by_name() {
  local json="$1"
  local name="$2"
  local field="$3"
  jq -er --arg name "$name" --arg field "$field" '
    first(
      (.Data // .data // .)[] |
      select((.Name // .name // "") == $name) |
      if $field == "Key" then .Key // .key
      elif $field == "Id" then .Id // .id
      elif $field == "ProcessKey" then .ProcessKey // .processKey // .PackageId // .packageId
      elif $field == "ProcessVersion" then .ProcessVersion // .processVersion // .Version // .version
      else .[$field] // empty
      end
    )
  ' <<<"$json"
}

resolve_input_file() {
  local ref="$1"
  local candidate

  if [[ "$ref" == /* || "$ref" =~ ^[A-Za-z]:[\\/] ]]; then
    [[ -f "$ref" ]] || return 1
    printf '%s\n' "$ref"
    return 0
  fi

  for candidate in \
    "$BASE_DIR/$ref" \
    "$MANIFEST_DIR/$ref" \
    "$MANIFEST_DIR/$(basename "$ref")"; do
    if [[ -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

log "Checking UiPath login"
LOGIN_STATUS_JSON="$(uip_json login status)"
if ! jq -e '(.Data.Status // .data.status // "") == "Logged in"' <<<"$LOGIN_STATUS_JSON" >/dev/null; then
  log "No active login; starting interactive UiPath login"
  uip_json login >/dev/null
fi

FOLDER="$(jq -er '.folder' <<<"$DEPLOYMENT_JSON")"
FOLDER_DESCRIPTION="$(jq -r '.description // ""' <<<"$DEPLOYMENT_JSON")"
PACKAGE_FEED="$(jq -r '.packageFeed // ""' <<<"$DEPLOYMENT_JSON")"

ensure_folder_path() {
  local path="$1"
  local description="$2"
  local current=""
  local part
  local -a parts

  IFS='/' read -r -a parts <<<"$path"
  for part in "${parts[@]}"; do
    [[ -n "$part" ]] || die "folder path contains an empty segment: $path"
    if [[ -z "$current" ]]; then
      current="$part"
    else
      current="$current/$part"
    fi

    if uip_json or folders get "$current" >/dev/null 2>&1; then
      log "Folder exists: $current"
      continue
    fi

    local -a create_args=(or folders create "$part")
    if [[ "$current" == */* ]]; then
      create_args+=(--parent "${current%/*}")
    elif [[ -n "$PACKAGE_FEED" && "$part" == "$PACKAGE_FEED" ]]; then
      # This repository treats each top-level category as a folder-hierarchy
      # package feed, inherited by all of its child folders.
      create_args+=(--feed-type FolderHierarchy)
    fi
    if [[ "$current" == "$path" && -n "$description" ]]; then
      create_args+=(--description "$description")
    fi
    log "Creating folder: $current"
    uip_json "${create_args[@]}" >/dev/null
  done
}

ensure_folder_path "$FOLDER" "$FOLDER_DESCRIPTION"

ASSET_COUNT="$(jq '(.assets // []) | length' <<<"$DEPLOYMENT_JSON")"
for ((i = 0; i < ASSET_COUNT; i++)); do
  ASSET="$(jq -c ".assets[$i]" <<<"$DEPLOYMENT_JSON")"
  ASSET_NAME="$(jq -er '.name' <<<"$ASSET")"
  ASSET_TYPE="$(jq -r '.type // "Text"' <<<"$ASSET")"
  ASSET_DESCRIPTION="$(jq -r '.description // ""' <<<"$ASSET")"
  ASSET_SCOPE="$(jq -r '.scope // "Global"' <<<"$ASSET")"

  ASSET_LIST="$(uip_json or assets list --folder-path "$FOLDER" --name "$ASSET_NAME" --limit 100)"
  if data_has_exact_name "$ASSET_LIST" "$ASSET_NAME"; then
    log "Asset exists: $ASSET_NAME"
    continue
  fi

  if jq -e 'has("value")' <<<"$ASSET" >/dev/null; then
    ASSET_VALUE="$(jq -r '.value | if type == "string" then . else tojson end' <<<"$ASSET")"
  elif jq -e 'has("valueFile")' <<<"$ASSET" >/dev/null; then
    VALUE_FILE_REF="$(jq -er '.valueFile' <<<"$ASSET")"
    VALUE_FILE="$(resolve_input_file "$VALUE_FILE_REF")" || \
      die "valueFile for asset '$ASSET_NAME' was not found: $VALUE_FILE_REF"
    ASSET_VALUE="$(<"$VALUE_FILE")"
  else
    die "asset '$ASSET_NAME' must define value or valueFile"
  fi

  CREATE_ASSET_ARGS=(or assets create "$ASSET_NAME" "$ASSET_VALUE" --folder-path "$FOLDER" --type "$ASSET_TYPE" --scope "$ASSET_SCOPE")
  [[ -z "$ASSET_DESCRIPTION" ]] || CREATE_ASSET_ARGS+=(--description "$ASSET_DESCRIPTION")
  CREDENTIAL_STORE_KEY="$(jq -r '.credentialStoreKey // ""' <<<"$ASSET")"
  [[ -z "$CREDENTIAL_STORE_KEY" ]] || CREATE_ASSET_ARGS+=(--credential-store-key "$CREDENTIAL_STORE_KEY")

  log "Creating asset: $ASSET_NAME"
  uip_json "${CREATE_ASSET_ARGS[@]}" >/dev/null
done

if jq -e '.queue != null' <<<"$DEPLOYMENT_JSON" >/dev/null; then
  QUEUE_NAME="$(jq -er '.queue.name' <<<"$DEPLOYMENT_JSON")"
  QUEUE_DESCRIPTION="$(jq -r '.queue.description // ""' <<<"$DEPLOYMENT_JSON")"
  QUEUE_LIST="$(uip_json or queues list --folder-path "$FOLDER" --name "$QUEUE_NAME" --limit 100)"
  if data_has_exact_name "$QUEUE_LIST" "$QUEUE_NAME"; then
    log "Queue exists: $QUEUE_NAME"
  else
    CREATE_QUEUE_ARGS=(or queues create "$QUEUE_NAME" --folder-path "$FOLDER")
    [[ -z "$QUEUE_DESCRIPTION" ]] || CREATE_QUEUE_ARGS+=(--description "$QUEUE_DESCRIPTION")
    log "Creating queue: $QUEUE_NAME"
    uip_json "${CREATE_QUEUE_ARGS[@]}" >/dev/null
  fi
fi

PACKAGE_ID="$(jq -er '.packageId' <<<"$DEPLOYMENT_JSON")"
PACKAGE_VERSION="$(jq -r '.packageVersion // ""' <<<"$DEPLOYMENT_JSON")"
PACKAGE_FILENAME="$(basename "$PACKAGE_FILE")"
[[ "$PACKAGE_FILENAME" == "$PACKAGE_ID".*.nupkg ]] || \
  die "package filename '$PACKAGE_FILENAME' does not match packageId '$PACKAGE_ID'"

if [[ -z "$PACKAGE_VERSION" ]]; then
  PACKAGE_VERSION="${PACKAGE_FILENAME#"$PACKAGE_ID."}"
  PACKAGE_VERSION="${PACKAGE_VERSION%.nupkg}"
  [[ -n "$PACKAGE_VERSION" && "$PACKAGE_VERSION" != "$PACKAGE_FILENAME" ]] || \
    die "could not derive packageVersion from package filename: $PACKAGE_FILENAME"
fi

FEED_NAME="$PACKAGE_FEED"
FEED_ARGS=()
if [[ -n "$FEED_NAME" ]]; then
  FEEDS_JSON="$(uip_json or feeds list)"
  FEED_ID="$(item_field_by_name "$FEEDS_JSON" "$FEED_NAME" Id || true)"
  [[ -n "$FEED_ID" ]] || die "package feed not found: $FEED_NAME"
  FEED_ARGS=(--feed-id "$FEED_ID")
fi

PACKAGES_JSON="$(uip_json or packages list --search "$PACKAGE_ID" --limit 100 "${FEED_ARGS[@]}")"
if jq -e --arg id "$PACKAGE_ID" --arg version "$PACKAGE_VERSION" '
  (.Data // .data // .) as $items |
  ($items | type) == "array" and any($items[];
    (.Id // .id // "") == $id and (.Version // .version // "") == $version)
' <<<"$PACKAGES_JSON" >/dev/null; then
  log "Package exists: $PACKAGE_ID:$PACKAGE_VERSION"
else
  log "Uploading package: $PACKAGE_ID:$PACKAGE_VERSION"
  uip_json or packages upload "$PACKAGE_FILE" "${FEED_ARGS[@]}" >/dev/null
fi

PROCESS_COUNT="$(jq '(.processes // []) | length' <<<"$DEPLOYMENT_JSON")"
for ((i = 0; i < PROCESS_COUNT; i++)); do
  PROCESS="$(jq -c ".processes[$i]" <<<"$DEPLOYMENT_JSON")"
  PROCESS_NAME="$(jq -er '.name' <<<"$PROCESS")"
  PROCESS_DESCRIPTION="$(jq -r '.description // ""' <<<"$PROCESS")"
  ENTRY_POINT="$(jq -er '.entryPoint' <<<"$PROCESS")"
  PROCESSES_JSON="$(uip_json or processes list --folder-path "$FOLDER" --name "$PROCESS_NAME" --limit 100)"

  if data_has_exact_name "$PROCESSES_JSON" "$PROCESS_NAME"; then
    PROCESS_KEY="$(item_field_by_name "$PROCESSES_JSON" "$PROCESS_NAME" Key)"
    EXISTING_PACKAGE_ID="$(item_field_by_name "$PROCESSES_JSON" "$PROCESS_NAME" ProcessKey || true)"
    EXISTING_VERSION="$(item_field_by_name "$PROCESSES_JSON" "$PROCESS_NAME" ProcessVersion || true)"
    if [[ -n "$EXISTING_PACKAGE_ID" && "$EXISTING_PACKAGE_ID" != "$PACKAGE_ID" ]]; then
      die "process '$PROCESS_NAME' is bound to package '$EXISTING_PACKAGE_ID', not '$PACKAGE_ID'"
    fi
    if [[ "$EXISTING_VERSION" != "$PACKAGE_VERSION" ]]; then
      log "Upgrading process: $PROCESS_NAME -> $PACKAGE_VERSION"
      uip_json or processes update-version "$PROCESS_KEY" --package-version "$PACKAGE_VERSION" --folder-path "$FOLDER" >/dev/null
    else
      log "Process version is current: $PROCESS_NAME"
    fi

    UPDATE_PROCESS_ARGS=(or processes update "$PROCESS_KEY" --name "$PROCESS_NAME" --entry-point "$ENTRY_POINT")
    [[ -z "$PROCESS_DESCRIPTION" ]] || UPDATE_PROCESS_ARGS+=(--description "$PROCESS_DESCRIPTION")
    uip_json "${UPDATE_PROCESS_ARGS[@]}" >/dev/null
  else
    CREATE_PROCESS_ARGS=(or processes create --folder-path "$FOLDER" --name "$PROCESS_NAME" --package-key "$PACKAGE_ID" --package-version "$PACKAGE_VERSION" --entry-point "$ENTRY_POINT")
    [[ -z "$PROCESS_DESCRIPTION" ]] || CREATE_PROCESS_ARGS+=(--description "$PROCESS_DESCRIPTION")
    log "Creating process: $PROCESS_NAME"
    uip_json "${CREATE_PROCESS_ARGS[@]}" >/dev/null
  fi
done

log "Deployment complete: $PACKAGE_ID:$PACKAGE_VERSION in $FOLDER"
