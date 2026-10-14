#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "${1:-}" != "--skip-build" ]]; then
  bash scripts/build.sh
fi
bash scripts/test.sh
stage="build/package/3D Desktop Native Experiment"
mkdir -p "$stage"
ditto "build/3D Desktop.app" "$stage/3D Desktop.app"
cp README.md "$stage/READ ME — EXPERIMENTAL.md"
ditto docs "$stage/docs"
cp ../LICENSE "$stage/LICENSE"
mkdir -p ../release/native
archive="../release/native/3D-Desktop-0.1.0-experimental-mac-arm64.zip"
ditto -c -k --sequesterRsrc --keepParent "$stage" "$archive"
(cd ../release/native && shasum -a 256 "${archive##*/}" > "${archive##*/}.sha256")
codesign --verify --strict "$stage/3D Desktop.app"
file "$stage/3D Desktop.app/Contents/MacOS/3D Desktop"
printf '%s\n' "$archive"
