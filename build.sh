#!/usr/bin/env bash
# Build JASON extension for Chrome, Firefox, and Edge
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
BUILD="$ROOT/build"

# Shared files copied into both builds
SHARED=(
  sidepanel.html
  sidepanel.js
  sidepanel.css
  prism.js
  prism-json.js
  prism-tomorrow.css
  icons
)

# ── Chrome ────────────────────────────────────────────────────
echo "Building Chrome..."
rm -rf "$BUILD/chrome"
mkdir -p "$BUILD/chrome"
cp "$ROOT/manifests/chrome.json" "$BUILD/chrome/manifest.json"
cp "$ROOT/backgrounds/chrome.js"  "$BUILD/chrome/background.js"
for f in "${SHARED[@]}"; do cp -r "$ROOT/$f" "$BUILD/chrome/"; done
echo "  → build/chrome/"

# ── Firefox ───────────────────────────────────────────────────
echo "Building Firefox..."
rm -rf "$BUILD/firefox"
mkdir -p "$BUILD/firefox"
cp "$ROOT/manifests/firefox.json" "$BUILD/firefox/manifest.json"
cp "$ROOT/backgrounds/firefox.js"  "$BUILD/firefox/background.js"
for f in "${SHARED[@]}"; do cp -r "$ROOT/$f" "$BUILD/firefox/"; done
echo "  → build/firefox/"

# ── Edge ──────────────────────────────────────────────────────
echo "Building Edge..."
rm -rf "$BUILD/edge"
mkdir -p "$BUILD/edge"
cp "$ROOT/manifests/edge.json" "$BUILD/edge/manifest.json"
cp "$ROOT/backgrounds/edge.js"  "$BUILD/edge/background.js"
for f in "${SHARED[@]}"; do cp -r "$ROOT/$f" "$BUILD/edge/"; done
echo "  → build/edge/"

# ── Create zip files (manifest.json at the root of the archive) ──
echo "Creating zip files..."
(cd "$BUILD/chrome"  && zip -r -q "$BUILD/jason-chrome.zip" .)
echo "  → build/jason-chrome.zip"
(cd "$BUILD/firefox" && zip -r -q "$BUILD/jason-firefox.zip" .)
echo "  → build/jason-firefox.zip"
(cd "$BUILD/edge"    && zip -r -q "$BUILD/jason-edge.zip" .)
echo "  → build/jason-edge.zip"

echo "Done."
