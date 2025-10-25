import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';

const dbPath = path.join(app.getPath('userData'), 'image-metahub.db');
const db = new Database(dbPath);

// --- Schema Initialization ---
function initializeSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS directories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      last_scan INTEGER
    );

    CREATE TABLE IF NOT EXISTS images (
      id TEXT PRIMARY KEY,
      directory_id INTEGER NOT NULL,
      relative_path TEXT NOT NULL,
      last_modified INTEGER NOT NULL,
      metadata_string TEXT,
      FOREIGN KEY (directory_id) REFERENCES directories (id) ON DELETE CASCADE
    );

    -- Indexes for performance
    CREATE INDEX IF NOT EXISTS idx_images_directory_id ON images (directory_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_images_path ON images (directory_id, relative_path);
  `);
  console.log('Database schema initialized.');
}

// --- Service Setup ---
function setupDatabaseService() {
  initializeSchema();

  // Graceful shutdown
  app.on('before-quit', () => {
    if (db && db.open) {
      db.close();
      console.log('Database connection closed.');
    }
  });

  return {
    addDirectory(directoryPath) {
      const name = path.basename(directoryPath);
      const stmt = db.prepare('INSERT OR IGNORE INTO directories (path, name) VALUES (?, ?)');
      stmt.run(directoryPath, name);

      const dir = db.prepare('SELECT id FROM directories WHERE path = ?').get(directoryPath);
      return dir;
    },

    upsertImages(images) {
      const stmt = db.prepare(`
        INSERT INTO images (id, directory_id, relative_path, last_modified, metadata_string)
        VALUES (@id, @directoryId, @relativePath, @lastModified, @metadataString)
        ON CONFLICT(id) DO UPDATE SET
          last_modified = excluded.last_modified,
          metadata_string = excluded.metadata_string;
      `);
      db.transaction((records) => {
        for (const record of records) stmt.run(record);
      })(images);
    },

    getImages(directoryId, offset = 0, limit = 50) {
      return db.prepare('SELECT * FROM images WHERE directory_id = ? LIMIT ? OFFSET ?')
               .all(directoryId, limit, offset);
    },
  };
}

export const databaseService = setupDatabaseService();
