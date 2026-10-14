#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build
xcrun clang -arch arm64 -mmacosx-version-min=14.0 -fobjc-arc -Wall -Wextra \
  -framework Cocoa -framework ApplicationServices Experiments/WindowServerProbe.m \
  -o build/WindowServerProbe
