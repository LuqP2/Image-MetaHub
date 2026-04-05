# Release Management Guide

This guide explains how to create rich, well-organized GitHub releases for the Image MetaHub project.

## Overview

The project now includes automated tools to generate professional release notes from your `CHANGELOG.md` file, making GitHub releases informative and user-friendly.

## Available Scripts

### `npm run generate-release <version>`
Generates rich release notes for a specific version from CHANGELOG.md.

```bash
npm run generate-release 1.7.4
```

### `npm run release-workflow <version>`
Complete automated workflow that:
- Updates package.json version
- Updates ARCHITECTURE.md version
- Generates release notes
- Commits changes
- Creates and pushes git tag
- Opens GitHub releases page

```bash
npm run release-workflow 1.7.4
```

## Release Process

### Option 1: Automated Workflow (Recommended)

1. **Update CHANGELOG.md** with the new version section
2. **Run the automated workflow**:
   ```bash
   npm run release-workflow 1.7.4
   ```
3. **Complete manual steps** (copy release notes to GitHub)

### Option 2: Manual Process

1. **Update versions**:
   ```bash
   # Update package.json
   npm version 1.7.4 --no-git-tag-version

   # Update ARCHITECTURE.md manually
   ```

2. **Generate release notes**:
   ```bash
   npm run generate-release 1.7.4
   ```

3. **Create and push tag**:
   ```bash
   git add .
   git commit -m "chore: bump version to v1.7.4"
   git tag v1.7.4
   git push origin main
   git push origin v1.7.4
   ```

4. **Create GitHub release**:
   - Go to [GitHub Releases](https://github.com/LuqP2/image-metahub/releases/new)
   - Select tag `v1.7.4`
   - Copy content from `release-v1.7.4.md`
   - Publish!

## Release Notes Format

The generated release notes include:

- **Rich formatting** with emojis and clear sections
- **Download links** for all platforms (Windows/macOS/Linux)
- **System requirements** and technical details
- **Changelog content** from CHANGELOG.md
- **Links** to documentation and issue tracker

### Example Structure:
```
# Image MetaHub v1.7.4

[Changelog content from CHANGELOG.md]

## Downloads
- Windows: .exe installer
- macOS: .dmg packages
- Linux: .AppImage

## What's New
[Detailed feature list]

## System Requirements
[Technical specs]

## Documentation
[Links to README, etc.]
```

## CHANGELOG.md Format

Keep your CHANGELOG.md following this structure:

```markdown
## [1.7.4] - 2025-09-24

### Fixed
- **Bug title**: Description of the fix

### Added
- **Feature title**: Description of new feature

### Technical Improvements
- **Improvement title**: Technical details
```

## Maintenance

### Files Generated:
- `release-v{VERSION}.md` - Release notes for GitHub

### Files Updated Automatically:
- `package.json` - Version number
- `ARCHITECTURE.md` - Version number

### Files to Update Manually:
- `CHANGELOG.md` - Add new version section before release

## Customization

You can customize the release template by editing `generate-release.js`:

- **Download links**: Update file naming patterns
- **System requirements**: Modify technical specifications
- **Links**: Update repository URLs
- **Emojis and formatting**: Adjust visual styling

## Benefits

 **Professional appearance** - Rich formatting with clear sections
 **User-friendly** - Clear download instructions for each platform
 **Comprehensive** - Includes all changelog information
 **Automated** - Reduces manual work for releases
 **Consistent** - Standardized format across all releases

## Troubleshooting

### "Version not found in CHANGELOG.md"
- Ensure the version exists in CHANGELOG.md with format `## [1.7.4] - YYYY-MM-DD`

### Release notes look wrong
- Check CHANGELOG.md formatting
- Verify version number is correct

### GitHub Actions fails
- Ensure tag is pushed before workflow runs
- Check that electron-builder configuration is correct