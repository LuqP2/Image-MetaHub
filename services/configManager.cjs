const fs = require('fs').promises;
const path = require('path');

class ConfigManager {
  constructor() {
    this.configPath = path.join(process.cwd(), 'app-config.json');
    this.config = {
      lastOpenedFolder: null,
      windowBounds: null,
      skippedVersions: []
    };
  }

  async loadConfig() {
    try {
      const data = await fs.readFile(this.configPath, 'utf8');
      this.config = { ...this.config, ...JSON.parse(data) };
      console.log('Config loaded:', this.config);
    } catch (error) {
      console.log('No config file found, using defaults');
      // File doesn't exist, use defaults
    }
    return this.config;
  }

  async saveConfig() {
    try {
      await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2));
      console.log('Config saved:', this.config);
    } catch (error) {
      console.error('Error saving config:', error);
    }
  }

  getLastOpenedFolder() {
    return this.config.lastOpenedFolder;
  }

  async setLastOpenedFolder(folderPath) {
    this.config.lastOpenedFolder = folderPath;
    await this.saveConfig();
  }

  getWindowBounds() {
    return this.config.windowBounds;
  }

  async setWindowBounds(bounds) {
    this.config.windowBounds = bounds;
    await this.saveConfig();
  }

  getSkippedVersions() {
    return this.config.skippedVersions || [];
  }

  async addSkippedVersion(version) {
    if (!this.config.skippedVersions) {
      this.config.skippedVersions = [];
    }
    if (!this.config.skippedVersions.includes(version)) {
      this.config.skippedVersions.push(version);
      await this.saveConfig();
    }
  }

  async clearSkippedVersions() {
    this.config.skippedVersions = [];
    await this.saveConfig();
  }
}

module.exports = new ConfigManager();