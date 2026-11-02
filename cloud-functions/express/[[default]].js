import express from 'express';
import pg from 'pg';

const app = express();
const usePostgres = Boolean(process.env.DATABASE_URL);

if (!usePostgres) {
  console.error('致命错误：未检测到 DATABASE_URL 环境变量！');
  process.exit(1);
}

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

app.use(express.json({ limit: '10kb' }));

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

// 获取单条留言（兼容前端点赞数据的格式）
async function findMessage(id) {
  const rows = await all(
    'SELECT id, nickname, content, likes, created_at FROM messages WHERE id = ?',
    [id]
  );
  if (!rows[0]) return null;
  
  const msg = rows[0];
  // 假设 likes 字段存的是 JSON 数组，例如：[{"userId": "1", "nickname": "张三"}]
  let likeData = [];
  try {
    likeData = typeof msg.likes === 'string' ? JSON.parse(msg.likes) : (msg.likes || []);
  } catch (e) {
    likeData = [];
  }
  
  return {
    ...msg,
    likes: likeData.length,
    likeNames: likeData.map(item => item.nickname),
    liked: likeData.some(item => item.userId === req.query.userId) // 检查当前用户是否点过赞
  };
}

// GET: 获取留言列表（支持分页）
app.get('/api/messages', async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const pageSize = 5; // 每页5条
    const offset = (page - 1) * pageSize;

    const messagesResult = await all(
      'SELECT id, nickname, content, likes, created_at FROM messages ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
      [pageSize, offset]
    );
    
    const totalResult = await all('SELECT COUNT(*) FROM messages');
    const total = Number(totalResult[0].count);

    // 处理点赞数据格式
    const messages = messagesResult.map(msg => {
      let likeData = [];
      try {
        likeData = typeof msg.likes === 'string' ? JSON.parse(msg.likes) : (msg.likes || []);
      } catch (e) {}
      
      const userId = req.query.userId;
      return {
        ...msg,
        likes: likeData.length,
        likeNames: likeData.map(item => item.nickname),
        liked: userId ? likeData.some(item => item.userId === userId) : false
      };
    });

    res.json({ messages, page, total, pageSize });
  } catch (error) {
    console.error('读取留言失败：', error.message);
    res.status(500).json({ error: '读取留言失败，请稍后重试。' });
  }
});

// POST: 发布留言
app.post('/api/messages', async (req, res) => {
  const nickname = typeof req.body.nickname === 'string' ? req.body.nickname.trim() : '';
  const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';

  if (!nickname || !content) {
    return res.status(400).json({ error: '昵称和留言内容都不能为空。' });
  }

  try {
    const rows = await all(
      `INSERT INTO messages (nickname, content, likes) VALUES (?, ?, '[]') RETURNING id, nickname, content, likes, created_at`,
      [nickname, content]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('保存留言失败：', error.message);
    res.status(500).json({ error: '保存留言失败，请稍后重试。' });
  }
});

// POST: 点赞/取消点赞
app.post('/api/messages/:id/like', async (req, res) => {
  const id = Number(req.params.id);
  const { userId, nickname } = req.body;

  if (!Number.isSafeInteger(id) || id < 1 || !userId) {
    return res.status(400).json({ error: '参数无效。' });
  }

  try {
    const rows = await all('SELECT likes FROM messages WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ error: '找不到这条留言。' });

    let likeData = [];
    try {
      likeData = typeof rows[0].likes === 'string' ? JSON.parse(rows[0].likes) : (rows[0].likes || []);
    } catch (e) {}

    const hasLikedIndex = likeData.findIndex(item => item.userId === userId);
    let liked = false;

    if (hasLikedIndex !== -1) {
      // 已经点过赞了，取消点赞
      likeData.splice(hasLikedIndex, 1);
      liked = false;
    } else {
      // 没点过赞，添加点赞
      likeData.push({ userId, nickname: nickname || '访客' });
      liked = true;
    }

    await run('UPDATE messages SET likes = ? WHERE id = ?', [JSON.stringify(likeData), id]);

    res.json({
      likes: likeData.length,
      likeNames: likeData.map(item => item.nickname),
      liked: liked
    });
  } catch (error) {
    console.error('点赞失败：', error.message);
    res.status(500).json({ error: '点赞失败，请稍后重试。' });
  }
});

// DELETE: 删除留言
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
        likes TEXT NOT NULL DEFAULT '[]',
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('已连接到 PostgreSQL 数据库，数据表准备就绪。');
  } catch (error) {
    console.error('初始化数据库失败：', error.message);
  }
}

initDB();
export default app;
