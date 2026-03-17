#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
cd "$SCRIPT_DIR"

usage() {
  cat <<'EOF'
Usage: ./edge-update-all.sh

Updates:
1) edge subtree (via edge-pull.sh)
2) remove @edgedev/template-engine and @edgedev/firebase
3) install latest @edgedev/template-engine and @edgedev/firebase
EOF
}

for arg in "$@"
do
  case "$arg" in
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg"
      echo
      usage
      exit 1
      ;;
  esac
done

if ! command -v pnpm >/dev/null 2>&1
then
  echo "pnpm is required (pnpm-lock.yaml is present), but it is not installed."
  echo "Install pnpm and rerun."
  exit 1
fi

sync_edge_functions() {
  edge_functions_dir="$SCRIPT_DIR/edge/functions"
  local_functions_dir="$SCRIPT_DIR/functions"

  if [ ! -d "$edge_functions_dir" ]; then
    return
  fi

  echo "==> Syncing edge/functions into local functions/"

  find "$edge_functions_dir" -type f | sort | while IFS= read -r src_file; do
    rel_path="${src_file#$edge_functions_dir/}"
    if [ "$rel_path" = "index.js" ]; then
      continue
    fi
    dest_file="$local_functions_dir/$rel_path"
    dest_dir="$(dirname "$dest_file")"

    mkdir -p "$dest_dir"

    cp "$src_file" "$dest_file"
  done
}

merge_edge_functions_index() {
  edge_index="$SCRIPT_DIR/edge/functions/index.js"
  local_index="$SCRIPT_DIR/functions/index.js"

  if [ ! -f "$edge_index" ] || [ ! -f "$local_index" ]; then
    return
  fi

  echo "==> Merging extra edge function exports into local functions/index.js"
  EDGE_FUNCTIONS_INDEX_PATH="$edge_index" LOCAL_FUNCTIONS_INDEX_PATH="$local_index" node <<'EOF'
const fs = require('fs')

const edgePath = process.env.EDGE_FUNCTIONS_INDEX_PATH
const localPath = process.env.LOCAL_FUNCTIONS_INDEX_PATH
const startMarker = '// START EXTRA EDGE functions'
const endMarker = '// END EXTRA EDGE functions'

const readText = filePath => fs.readFileSync(filePath, 'utf8')

const extractMarkedBlock = (text) => {
  const start = text.indexOf(startMarker)
  const end = text.indexOf(endMarker)
  if (start === -1 || end === -1 || end < start)
    throw new Error(`Missing ${startMarker}/${endMarker} block in ${edgePath}`)

  const endLine = text.indexOf('\n', end)
  return endLine === -1 ? text.slice(start) : text.slice(start, endLine + 1)
}

const replaceMarkedBlock = (text, replacement) => {
  const start = text.indexOf(startMarker)
  const end = text.indexOf(endMarker)
  const edgeFirebaseEndMarker = '// END @edge/firebase functions'

  if (start === -1 || end === -1 || end < start) {
    const edgeFirebaseEnd = text.indexOf(edgeFirebaseEndMarker)
    if (edgeFirebaseEnd !== -1) {
      const edgeFirebaseEndLine = text.indexOf('\n', edgeFirebaseEnd)
      const insertAt = edgeFirebaseEndLine === -1 ? text.length : edgeFirebaseEndLine + 1
      const before = text.slice(0, insertAt)
      const after = text.slice(insertAt)
      const joiner = before.endsWith('\n\n') ? '' : '\n'
      return `${before}${joiner}${replacement}${after}`
    }
    const normalized = text.endsWith('\n') ? text : `${text}\n`
    return `${normalized}\n${replacement}`
  }

  const endLine = text.indexOf('\n', end)
  const after = endLine === -1 ? '' : text.slice(endLine + 1)
  return `${text.slice(0, start)}${replacement}${after}`
}

const edgeText = readText(edgePath)
const localText = readText(localPath)
const edgeBlock = extractMarkedBlock(edgeText)
const mergedText = replaceMarkedBlock(localText, edgeBlock)

fs.writeFileSync(localPath, mergedText.endsWith('\n') ? mergedText : `${mergedText}\n`)
EOF
}

merge_firestore_indexes() {
  edge_indexes="$SCRIPT_DIR/edge/root/firestore.indexes.json"
  local_indexes="$SCRIPT_DIR/firestore.indexes.json"

  if [ ! -f "$edge_indexes" ]; then
    return
  fi

  if [ ! -f "$local_indexes" ]; then
    echo "==> Writing firestore.indexes.json from edge/root"
    cp "$edge_indexes" "$local_indexes"
    return
  fi

  echo "==> Merging firestore.indexes.json with edge/root priority"
  EDGE_INDEXES_PATH="$edge_indexes" LOCAL_INDEXES_PATH="$local_indexes" node <<'EOF'
const fs = require('fs')

const edgePath = process.env.EDGE_INDEXES_PATH
const localPath = process.env.LOCAL_INDEXES_PATH

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'))
const edgeJson = readJson(edgePath)
const localJson = readJson(localPath)

const normalizeArray = value => Array.isArray(value) ? value : []
const makeKey = index => JSON.stringify({
  collectionGroup: index?.collectionGroup || '',
  queryScope: index?.queryScope || 'COLLECTION',
  fields: normalizeArray(index?.fields).map(field => ({
    fieldPath: field?.fieldPath || '',
    order: field?.order || '',
    arrayConfig: field?.arrayConfig || '',
    vectorConfig: field?.vectorConfig || null,
  })),
})

const mergedMap = new Map()
for (const index of normalizeArray(localJson.indexes))
  mergedMap.set(makeKey(index), index)
for (const index of normalizeArray(edgeJson.indexes))
  mergedMap.set(makeKey(index), index)

const merged = {
  ...localJson,
  ...edgeJson,
  indexes: Array.from(mergedMap.values()),
}

fs.writeFileSync(localPath, `${JSON.stringify(merged, null, 2)}\n`)
EOF
}

merge_history_config() {
  edge_history_config="$SCRIPT_DIR/edge/root/history.config.json"
  local_history_config="$SCRIPT_DIR/functions/history.config.json"

  if [ ! -f "$edge_history_config" ]; then
    return
  fi

  if [ ! -f "$local_history_config" ]; then
    echo "==> Writing functions/history.config.json from edge/root"
    mkdir -p "$(dirname "$local_history_config")"
    cp "$edge_history_config" "$local_history_config"
    return
  fi

  echo "==> Merging functions/history.config.json with local priority"
  EDGE_HISTORY_CONFIG_PATH="$edge_history_config" LOCAL_HISTORY_CONFIG_PATH="$local_history_config" node <<'EOF'
const fs = require('fs')

const edgePath = process.env.EDGE_HISTORY_CONFIG_PATH
const localPath = process.env.LOCAL_HISTORY_CONFIG_PATH

const readJson = filePath => JSON.parse(fs.readFileSync(filePath, 'utf8'))

const isPlainObject = value => {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const mergeWithLocalPriority = (edgeValue, localValue) => {
  if (localValue === undefined)
    return edgeValue

  if (Array.isArray(edgeValue) || Array.isArray(localValue))
    return localValue

  if (isPlainObject(edgeValue) && isPlainObject(localValue)) {
    const merged = { ...edgeValue }
    for (const key of Object.keys(localValue))
      merged[key] = mergeWithLocalPriority(edgeValue?.[key], localValue[key])
    return merged
  }

  return localValue
}

const edgeJson = readJson(edgePath)
const localJson = readJson(localPath)
const merged = mergeWithLocalPriority(edgeJson, localJson)

fs.writeFileSync(localPath, `${JSON.stringify(merged, null, 2)}\n`)
EOF
}

echo "==> Updating edge subtree"
"$SCRIPT_DIR/edge-pull.sh"

sync_edge_functions
merge_edge_functions_index
merge_firestore_indexes
merge_history_config

echo "==> Removing @edgedev packages"
pnpm remove @edgedev/template-engine @edgedev/firebase

echo "==> Installing latest @edgedev packages"
pnpm add @edgedev/template-engine@latest @edgedev/firebase@latest

echo "==> Done"
