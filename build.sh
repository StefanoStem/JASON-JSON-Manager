#!/usr/bin/env bash
# Build JASON extension for Chrome and Firefox
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

echo "Done."
