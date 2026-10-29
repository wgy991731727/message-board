import express from 'express';
import pg from 'pg';

const app = express();
// 强制使用 PostgreSQL，如果没配置环境变量，启动时会直接报错提示
const usePostgres = Boolean(process.env.DATABASE_URL);

if (!usePostgres) {
  console.error('致命错误：未检测到 DATABASE_URL 环境变量，请先在 EdgeOne 控制台配置！');
  process.exit(1);
}

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

app.use(express.json({ limit: '10kb' }));

// 统一使用 PostgreSQL 语法
async function all(sql, params = []) {
  let index = 0;
  const postgresSql = sql.replace(/\?/g, () => `$${++index}`);
  const result = await pool.query(postgresSql, params);
  return result.rows;
}

async function run(sql, params = []) {
  let index = 0;
  const postgresSql = sql.replace(/\?/g, () => `$${++index}`);
  const result = await pool.query(postgresSql, params);
  return { changes: result.rowCount };
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
  const nickname = typeof req.body.nickname === 'string' ? req.body.nickname.trim() : '';
  const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';

  if (!nickname || !content) {
    return res.status(400).json({ error: '昵称和留言内容都不能为空。' });
  }

  if (nickname.length > 30 || content.length > 1000) {
    return res.status(400).json({ error: '昵称最多 30 个字，留言最多 1000 个字。' });
  }

  try {
    const rows = await all(
      `INSERT INTO messages (nickname, content)
       VALUES (?, ?)
       RETURNING id, nickname, content, likes, created_at`,
      [nickname, content]
    );
    res.status(201).json(rows[0]);
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
    const result = await run('UPDATE messages SET likes = likes + 1 WHERE id = ?', [id]);
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

// 初始化数据库
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id BIGSERIAL PRIMARY KEY,
        nickname TEXT NOT NULL,
        content TEXT NOT NULL,
        likes INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('已连接到 PostgreSQL 数据库，数据表准备就绪。');
  } catch (error) {
    console.error('初始化数据库失败：', error.message);
  }
}

initDB();

// 导出 app 供 EdgeOne 调用
export default app;
