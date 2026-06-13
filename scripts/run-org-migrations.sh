#!/usr/bin/env bash

set -e

# Resolve to backend root (parent of this scripts directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

echo "Running migrate-existing-users-to-org (npm run migrate:users-to-org)..."
npm run migrate:users-to-org

echo "Running attach-data-to-org (npm run migrate:attach-data-to-org)..."
npm run migrate:attach-data-to-org

echo "Running set-superadmin-no-org (npm run script:set-superadmin-no-org)..."
npm run script:set-superadmin-no-org

echo "All organization migration scripts completed."

