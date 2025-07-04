#!/bin/bash

# Release script for effect-amqp
# Usage: ./scripts/release.sh [major|minor|patch]

set -e

# Check if we're on main branch
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "Error: Must be on main branch to create a release"
  exit 1
fi

# Check if working directory is clean
if ! git diff-index --quiet HEAD --; then
  echo "Error: Working directory is not clean. Please commit all changes."
  exit 1
fi

# Get the version type (major, minor, patch)
VERSION_TYPE=${1:-patch}

if [[ ! "$VERSION_TYPE" =~ ^(major|minor|patch)$ ]]; then
  echo "Error: Version type must be 'major', 'minor', or 'patch'"
  echo "Usage: $0 [major|minor|patch]"
  exit 1
fi

echo "Creating $VERSION_TYPE release..."

# Update version in package.json
npm version $VERSION_TYPE --no-git-tag-version

# Get the new version
NEW_VERSION=$(node -p "require('./package.json').version")

echo "New version: $NEW_VERSION"

# Run tests to make sure everything works
echo "Running tests..."
npm run lint
npm run build
npm test

# Commit the version bump
git add package.json
git commit -m "chore: bump version to $NEW_VERSION"

# Create and push tag
git tag "v$NEW_VERSION"
git push origin main
git push origin "v$NEW_VERSION"

echo "✅ Release v$NEW_VERSION created successfully!"
echo "🚀 GitHub Actions will now build and publish to npm automatically."
echo "📦 Check the progress at: https://github.com/anglinb/effect-amqp/actions"