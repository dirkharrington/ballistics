#!/bin/sh
# Stages WASM artifacts and hand-written engine files into
# src/main/resources/static/wasm/ for Vite to bundle.
# Called by both Maven (pom.xml exec-maven-plugin) and CI.
# Resolves all paths relative to this script's directory so the
# working directory at call time doesn't matter.
set -e

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "${SCRIPT_DIR}/.." && pwd)
PKG_DIR="${SCRIPT_DIR}/pkg"
WASM_DIR="${REPO_ROOT}/src/main/resources/static/wasm"

if [ ! -f "${PKG_DIR}/ballistics_engine.js" ]; then
    echo "stage.sh: missing ${PKG_DIR}/ballistics_engine.js — run wasm-pack build first" >&2
    exit 1
fi

if [ ! -f "${PKG_DIR}/ballistics_engine_bg.wasm" ]; then
    echo "stage.sh: missing ${PKG_DIR}/ballistics_engine_bg.wasm — run wasm-pack build first" >&2
    exit 1
fi

rm -rf "${WASM_DIR}"
mkdir -p "${WASM_DIR}"

cp "${PKG_DIR}/ballistics_engine.js"      "${WASM_DIR}/ballistics_engine.js"
cp "${PKG_DIR}/ballistics_engine_bg.wasm" "${WASM_DIR}/ballistics_engine_bg.wasm"
cp "${PKG_DIR}/ballistics_engine.d.ts"    "${WASM_DIR}/ballistics_engine.d.ts"
cp "${SCRIPT_DIR}/loader.js"              "${WASM_DIR}/loader.js"
cp "${SCRIPT_DIR}/loader.d.ts"            "${WASM_DIR}/loader.d.ts"
cp "${SCRIPT_DIR}/protocol.d.ts"          "${WASM_DIR}/protocol.d.ts"
cp "${SCRIPT_DIR}/worker-core.js"         "${WASM_DIR}/worker-core.js"
cp "${SCRIPT_DIR}/engine.worker.js"       "${WASM_DIR}/engine.worker.js"
cp "${SCRIPT_DIR}/engine-entry.js"        "${WASM_DIR}/engine-entry.js"

echo "stage.sh: staged WASM artifacts to ${WASM_DIR}"
