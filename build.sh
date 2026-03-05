#!/usr/bin/env bash
# Build JASON extension for Chrome and Firefox
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
BUILD="$ROOT/build"

# Release guard: fail if debug ingest endpoints or telemetry markers are present
TELEMETRY_MARKERS=(
  '127.0.0.1:7244'
  '/ingest/'
  '#region agent log'
)
for marker in "${TELEMETRY_MARKERS[@]}"; do
  if grep -r --include='*.js' --include='*.html' "$marker" "$ROOT" 2>/dev/null | grep -v -e "$BUILD" -e 'node_modules' | grep -q .; then
    echo "Release guard failed: telemetry or debug ingest marker found: $marker"
    exit 1
  fi
done

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

# ── Create zip files (manifest.json at the root of the archive) ──
echo "Creating zip files..."
(cd "$BUILD/chrome"  && zip -r -q "$BUILD/jason-chrome.zip" .)
echo "  → build/jason-chrome.zip"
(cd "$BUILD/firefox" && zip -r -q "$BUILD/jason-firefox.zip" .)
echo "  → build/jason-firefox.zip"

# Manifest sync check: fail if build manifests diverge from source
for browser in chrome firefox; do
  if ! cmp -s "$ROOT/manifests/$browser.json" "$BUILD/$browser/manifest.json"; then
    echo "Manifest sync failed: build/$browser/manifest.json diverges from manifests/$browser.json"
    exit 1
  fi
done

echo "Done."
