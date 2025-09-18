# Release Guide

## How to Release New Versions

### 1. Update Version
```bash
# Update version in package.json
npm version patch  # for bug fixes (1.3.0 -> 1.3.1)
npm version minor  # for new features (1.3.0 -> 1.4.0)
npm version major  # for breaking changes (1.3.0 -> 2.0.0)
```

### 2. Update CHANGELOG.md
Add new version section with:
- **Added**: New features
- **Fixed**: Bug fixes
- **Changed**: Changes in existing functionality

### 3. Build and Publish
```bash
# Build installer and publish to GitHub Releases
npm run release
```

### 4. Create GitHub Release
1. Go to GitHub → Releases → Create new release
2. Tag version: `v1.x.x` (auto-created by npm version)
3. Release title: `v1.x.x - Release Name`
4. Add release notes from CHANGELOG.md
5. Upload the `.exe` file from `dist-electron/`
6. Mark as "Latest release"

## Auto-Update Process

### For Users:
1. **Automatic Check**: App checks for updates 3 seconds after opening
2. **Notification**: User sees dialog about available update
3. **Download**: Update downloads in background
4. **Install**: User chooses to restart now or later

### For Developers:
- Users automatically get notified about new versions
- No need to manually distribute updates
- GitHub Releases serves as update server

## Version Strategy
- **v1.x.x**: Current stable branch
- **Patch (1.3.1)**: Bug fixes, small improvements
- **Minor (1.4.0)**: New features, major improvements
- **Major (2.0.0)**: Breaking changes, complete rewrites

## Testing Updates
1. Create test release with pre-release flag
2. Test auto-updater with beta users
3. Create stable release when confirmed working
