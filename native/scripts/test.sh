#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build
xcrun swiftc -swift-version 5 -O -framework QuartzCore Sources/Projection.swift Tests/ProjectionTests.swift -o build/ProjectionTests
build/ProjectionTests
bash -n scripts/*.sh
