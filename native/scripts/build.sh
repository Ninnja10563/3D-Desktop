#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
app="build/3D Desktop.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
xcrun swiftc -swift-version 5 -O -g -target arm64-apple-macos14.0 \
  -framework AppKit -framework ApplicationServices -framework ScreenCaptureKit \
  -framework Carbon -framework QuartzCore -framework IOSurface \
  Sources/Projection.swift Sources/ProofSession.swift Sources/main.swift \
  -o "$app/Contents/MacOS/3D Desktop"
cp Info.plist "$app/Contents/Info.plist"
codesign --force --sign - "$app"
codesign --verify --strict "$app"
printf '%s\n' "$PWD/$app"
