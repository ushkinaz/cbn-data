#!/bin/bash
set -e

echo "=== Local CI Test ==="

# Check prerequisites
if [ -z "$GITHUB_TOKEN" ]; then
  echo "❌ GITHUB_TOKEN not set"
  echo "   Set it with: export GITHUB_TOKEN=\"ghp_...\""
  exit 1
fi

echo "✅ GITHUB_TOKEN set"

# Set variables
export GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-ushkinaz/cbn-data}"
export GITHUB_WORKSPACE="${GITHUB_WORKSPACE:-./workspace}"
export DATA_BRANCH="${DATA_BRANCH:-dev}"

echo "📦 Repository: $GITHUB_REPOSITORY"
echo "🌿 Branch: $DATA_BRANCH"

echo "📥 Running data pull..."
node pull-data-launcher.js

echo ""
echo "✅ Data pull complete"
echo ""
echo "🎨 To test GFX conversion:"
echo "   1. Check for new builds: ls -la data/"
echo "   2. Stage GFX: node gfx.mjs stage '[\"data/YYYY-MM-DD/gfx\"]'"
echo "   3. Convert PNGs to WebP in .gfx-webp-stage/"
echo "   4. Commit: node gfx.mjs commit"
