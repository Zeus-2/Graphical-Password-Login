import sqlite3Pkg from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const sqlite3 = sqlite3Pkg.verbose();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// DATABASE
// ============================================================================

class Database {
  constructor(dbPath = null) {
    this.dbPath = dbPath || path.join(__dirname, '../../graphical-auth.db');
    this.db = null;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          reject(err);
        } else {
          this.db.run('PRAGMA foreign_keys = ON', (err) => {
            if (err) reject(err);
            else resolve();
          });
        }
      });
    });
  }

  async initializeSchema() {
    const schema = `
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        registered_image_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_login_at INTEGER,
        failed_attempts INTEGER DEFAULT 0,
        locked_until INTEGER,
        FOREIGN KEY (registered_image_id) REFERENCES images(image_id)
      );

      CREATE TABLE IF NOT EXISTS images (
        image_id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        color TEXT NOT NULL,
        sound TEXT NOT NULL,
        habitat TEXT NOT NULL,
        category TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS auth_sessions (
        session_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        state TEXT NOT NULL,
        selected_image_id TEXT,
        property_type TEXT,
        correct_answer TEXT,
        property_options TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_property_type TEXT,
        FOREIGN KEY (user_id) REFERENCES users(user_id)
      );

      CREATE TABLE IF NOT EXISTS user_sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_activity_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(user_id)
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        log_id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        event_type TEXT NOT NULL,
        success INTEGER NOT NULL,
        session_id TEXT,
        ip_address TEXT,
        user_agent TEXT,
        failure_reason TEXT,
        metadata TEXT,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_users_image ON users(registered_image_id);
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
    `;

    const statements = schema.split(';').filter(stmt => stmt.trim());
    for (const statement of statements) {
      await this.run(statement);
    }
  }

  async seedImages() {
    const images = [
      { imageId: 'elephant_001', fileName: 'elephant.svg', displayName: 'Elephant', color: 'gray', sound: 'trumpet', habitat: 'savanna', category: 'mammal' },
      { imageId: 'lion_001', fileName: 'lion.svg', displayName: 'Lion', color: 'golden', sound: 'roar', habitat: 'savanna', category: 'mammal' },
      { imageId: 'dolphin_001', fileName: 'dolphin.svg', displayName: 'Dolphin', color: 'gray', sound: 'click', habitat: 'ocean', category: 'mammal' },
      { imageId: 'eagle_001', fileName: 'eagle.svg', displayName: 'Eagle', color: 'brown', sound: 'screech', habitat: 'mountains', category: 'bird' },
      { imageId: 'frog_001', fileName: 'frog.svg', displayName: 'Frog', color: 'green', sound: 'croak', habitat: 'wetlands', category: 'amphibian' }
    ];

    const sql = 'INSERT OR IGNORE INTO images (image_id, file_name, display_name, color, sound, habitat, category) VALUES (?, ?, ?, ?, ?, ?, ?)';
    for (const img of images) {
      await this.run(sql, [img.imageId, img.fileName, img.displayName, img.color, img.sound, img.habitat, img.category]);
    }
  }

  async query(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  async get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  async run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  async transaction(callback) {
    await this.run('BEGIN TRANSACTION');
    try {
      const result = await callback(this);
      await this.run('COMMIT');
      return result;
    } catch (error) {
      await this.run('ROLLBACK');
      throw error;
    }
  }

  async close() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) reject(err);
          else {
            this.db = null;
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }
}

// ============================================================================
// USER REPOSITORY
// ============================================================================

class UserRepository {
  constructor(database) {
    this.db = database;
  }

  async createUser(userId, imageId) {
    const now = Date.now();
    await this.db.run(
      'INSERT INTO users (user_id, registered_image_id, created_at, failed_attempts) VALUES (?, ?, ?, ?)',
      [userId, imageId, now, 0]
    );

    return {
      userId,
      registeredImageId: imageId,
      createdAt: now,
      lastLoginAt: null,
      failedAttempts: 0,
      lockedUntil: null
    };
  }

  async getUserById(userId) {
    const row = await this.db.get('SELECT * FROM users WHERE user_id = ?', [userId]);
    if (!row) return null;

    return {
      userId: row.user_id,
      registeredImageId: row.registered_image_id,
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at,
      failedAttempts: row.failed_attempts,
      lockedUntil: row.locked_until
    };
  }

  async getUserByImageId(imageId) {
    const row = await this.db.get('SELECT * FROM users WHERE registered_image_id = ?', [imageId]);
    if (!row) return null;

    return {
      userId: row.user_id,
      registeredImageId: row.registered_image_id,
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at,
      failedAttempts: row.failed_attempts,
      lockedUntil: row.locked_until
    };
  }

  async updateUserImage(userId, imageId) {
    const result = await this.db.run(
      'UPDATE users SET registered_image_id = ? WHERE user_id = ?',
      [imageId, userId]
    );
    return result.changes > 0;
  }
}

// ============================================================================
// IMAGE REPOSITORY
// ============================================================================

class ImageRepository {
  constructor(database) {
    this.db = database;
  }

  async getImageById(imageId) {
    const row = await this.db.get('SELECT * FROM images WHERE image_id = ?', [imageId]);
    if (!row) return null;

    return {
      imageId: row.image_id,
      fileName: row.file_name,
      displayName: row.display_name,
      properties: {
        color: row.color,
        sound: row.sound,
        habitat: row.habitat,
        category: row.category
      },
      metadata: { width: 800, height: 600, format: 'jpg' }
    };
  }

  async getAllImages() {
    const rows = await this.db.query('SELECT * FROM images');
    return rows.map(row => ({
      imageId: row.image_id,
      fileName: row.file_name,
      displayName: row.display_name,
      properties: {
        color: row.color,
        sound: row.sound,
        habitat: row.habitat,
        category: row.category
      },
      metadata: { width: 800, height: 600, format: 'jpg' }
    }));
  }

  async getImageProperties(imageId) {
    const row = await this.db.get(
      'SELECT color, sound, habitat, category FROM images WHERE image_id = ?',
      [imageId]
    );
    if (!row) return null;

    return {
      color: row.color,
      sound: row.sound,
      habitat: row.habitat,
      category: row.category
    };
  }

  async getRandomImages(count, excludeIds = []) {
    let sql = 'SELECT * FROM images';
    const params = [];

    if (excludeIds.length > 0) {
      const placeholders = excludeIds.map(() => '?').join(',');
      sql += ` WHERE image_id NOT IN (${placeholders})`;
      params.push(...excludeIds);
    }

    sql += ' ORDER BY RANDOM() LIMIT ?';
    params.push(count);

    const rows = await this.db.query(sql, params);
    return rows.map(row => ({
      imageId: row.image_id,
      fileName: row.file_name,
      displayName: row.display_name,
      properties: {
        color: row.color,
        sound: row.sound,
        habitat: row.habitat,
        category: row.category
      },
      metadata: { width: 800, height: 600, format: 'jpg' }
    }));
  }
}

export { Database, UserRepository, ImageRepository };
