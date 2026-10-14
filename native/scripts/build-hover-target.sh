#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
target_app="build/3D Desktop Hover Target.app"
mkdir -p "$target_app/Contents/MacOS"
xcrun swiftc -swift-version 5 -parse-as-library -O -g -target arm64-apple-macos14.0 \
  -framework AppKit -framework CoreGraphics \
  Probes/HoverTarget.swift -o "$target_app/Contents/MacOS/3D Desktop Hover Target"
cat > "$target_app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>studio.depth.desktop.hover-target</string>
  <key>CFBundleExecutable</key><string>3D Desktop Hover Target</string>
  <key>CFBundleName</key><string>3D Desktop Hover Target</string>
  <key>CFBundleDisplayName</key><string>3D Desktop Hover Target</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSSupportsAutomaticGraphicsSwitching</key><true/>
</dict></plist>
PLIST
codesign --force --sign - "$target_app"
codesign --verify --strict "$target_app"
printf '%s\n' "$PWD/$target_app"
