const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const usePostgres = Boolean(process.env.DATABASE_URL);
let db;
let pool;
let databaseReady;

if (usePostgres) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });
} else {
  const sqlite3 = require('sqlite3').verbose();
  const databasePath =
    process.env.SQLITE_DATABASE_PATH || path.join(__dirname, 'database.db');
  db = new sqlite3.Database(databasePath, (error) => {
    if (error) {
      console.error('无法打开 SQLite 数据库：', error.message);
    } else {
      console.log('已连接到本地 SQLite 数据库。');
    }
  });
}

app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function initializeDatabase() {
  if (!databaseReady) {
    databaseReady = (async () => {
      if (pool) {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS messages (
            id BIGSERIAL PRIMARY KEY,
            nickname TEXT NOT NULL,
            content TEXT NOT NULL,
            likes INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `);
        console.log('已连接到 PostgreSQL 数据库。');
        return;
      }

      await new Promise((resolve, reject) => {
        db.run(
          `CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nickname TEXT NOT NULL,
            content TEXT NOT NULL,
            likes INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          )`,
          (error) => (error ? reject(error) : resolve())
        );
      });

      const columns = await all('PRAGMA table_info(messages)');
      if (!columns.some((column) => column.name === 'likes')) {
        await run(
          'ALTER TABLE messages ADD COLUMN likes INTEGER NOT NULL DEFAULT 0'
        );
        console.log('已为本地留言表添加点赞数字段。');
      }
      console.log('已连接到本地 SQLite 数据库。');
    })().catch((error) => {
      databaseReady = undefined;
      throw error;
    });
  }

  return databaseReady;
}

app.use('/api', async (req, res, next) => {
  try {
    await initializeDatabase();
    next();
  } catch (error) {
    console.error('初始化数据库失败：', error.message);
    res.status(500).json({ error: '数据库暂时不可用，请稍后重试。' });
  }
});

function all(sql, params = []) {
  if (pool) {
    let index = 0;
    const postgresSql = sql.replace(/\?/g, () => `$${++index}`);
    return pool.query(postgresSql, params).then((result) => result.rows);
  }

  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
      } else {
        resolve(rows);
      }
    });
  });
}

function run(sql, params = []) {
  if (pool) {
    let index = 0;
    const postgresSql = sql.replace(/\?/g, () => `$${++index}`);
    return pool.query(postgresSql, params).then((result) => ({
      changes: result.rowCount,
    }));
  }

  return new Promise((resolve, reject) => {
    db.run(sql, params, function (error) {
      if (error) {
        reject(error);
      } else {
        resolve({ changes: this.changes, lastID: this.lastID });
      }
    });
  });
}

async function findMessage(id) {
  const rows = await all(
    'SELECT id, nickname, content, likes, created_at FROM messages WHERE id = ?',
    [id]
  );
  return rows[0];
}

app.get('/api/messages', async (req, res) => {
  try {
    const messages = await all(`
      SELECT id, nickname, content, likes, created_at
      FROM messages
      ORDER BY created_at DESC, id DESC
    `);
    res.json(messages);
  } catch (error) {
    console.error('读取留言失败：', error.message);
    res.status(500).json({ error: '读取留言失败，请稍后重试。' });
  }
});

app.post('/api/messages', async (req, res) => {
  const nickname =
    typeof req.body.nickname === 'string' ? req.body.nickname.trim() : '';
  const content =
    typeof req.body.content === 'string' ? req.body.content.trim() : '';

  if (!nickname || !content) {
    return res.status(400).json({ error: '昵称和留言内容都不能为空。' });
  }

  if (nickname.length > 30 || content.length > 1000) {
    return res.status(400).json({ error: '昵称最多 30 个字，留言最多 1000 个字。' });
  }

  try {
    if (pool) {
      const rows = await all(
        `INSERT INTO messages (nickname, content)
         VALUES (?, ?)
         RETURNING id, nickname, content, likes, created_at`,
        [nickname, content]
      );
      return res.status(201).json(rows[0]);
    }

    const result = await run(
      'INSERT INTO messages (nickname, content) VALUES (?, ?)',
      [nickname, content]
    );
    const message = await findMessage(result.lastID);
    res.status(201).json(message);
  } catch (error) {
    console.error('保存留言失败：', error.message);
    res.status(500).json({ error: '保存留言失败，请稍后重试。' });
  }
});

app.post('/api/messages/:id/like', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(400).json({ error: '留言编号无效。' });
  }

  try {
    const result = await run(
      'UPDATE messages SET likes = likes + 1 WHERE id = ?',
      [id]
    );
    if (result.changes === 0) {
      return res.status(404).json({ error: '找不到这条留言。' });
    }

    res.json(await findMessage(id));
  } catch (error) {
    console.error('点赞失败：', error.message);
    res.status(500).json({ error: '点赞失败，请稍后重试。' });
  }
});

app.delete('/api/messages/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(400).json({ error: '留言编号无效。' });
  }

  try {
    const result = await run('DELETE FROM messages WHERE id = ?', [id]);
    if (result.changes === 0) {
      return res.status(404).json({ error: '找不到这条留言。' });
    }

    res.status(204).end();
  } catch (error) {
    console.error('删除留言失败：', error.message);
    res.status(500).json({ error: '删除失败，请稍后重试。' });
  }
});

async function startServer() {
  await initializeDatabase();
  app.listen(PORT, () => {
    console.log(`留言板服务器已启动：http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('初始化数据库失败：', error.message);
    if (pool) {
      pool.end();
    }
    if (db) {
      db.close();
    }
    process.exitCode = 1;
  });
}

module.exports = { app, initializeDatabase };
