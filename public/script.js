const form = document.querySelector('#message-form');
const nicknameInput = document.querySelector('#nickname');
const contentInput = document.querySelector('#content');
const submitButton = document.querySelector('#submit-button');
const statusElement = document.querySelector('#status');
const messagesList = document.querySelector('#messages-list');
const themeToggle = document.querySelector('#theme-toggle');
const themeIcon = document.querySelector('#theme-icon');
const themeLabel = document.querySelector('#theme-label');
let statusTimeout;

function applyTheme(isDark) {
  document.documentElement.classList.toggle('dark', isDark);
  themeToggle.setAttribute('aria-pressed', String(isDark));
  themeToggle.setAttribute(
    'aria-label',
    isDark ? '切换到浅色模式' : '切换到暗黑模式'
  );
  themeIcon.textContent = isDark ? '☀️' : '🌙';
  themeLabel.textContent = isDark ? '浅色模式' : '深色模式';
}

const savedTheme = localStorage.getItem('message-board-theme');
applyTheme(
  savedTheme === 'dark' ||
    (savedTheme === null &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)
);

themeToggle.addEventListener('click', () => {
  const isDark = !document.documentElement.classList.contains('dark');
  applyTheme(isDark);
  localStorage.setItem('message-board-theme', isDark ? 'dark' : 'light');
});

function setStatus(message, isError = false, duration = 0) {
  window.clearTimeout(statusTimeout);
  statusElement.textContent = message;
  statusElement.classList.toggle('text-rose-700', isError);
  statusElement.classList.toggle('dark:text-rose-300', isError);
  statusElement.classList.toggle('text-emerald-700', !isError);
  statusElement.classList.toggle('dark:text-emerald-300', !isError);

  if (message && duration > 0) {
    statusTimeout = window.setTimeout(() => {
      statusElement.textContent = '';
    }, duration);
  }
}

function addMessageToPage(message, prepend = false) {
  const item = document.createElement('li');
  item.className =
    'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md sm:p-6 dark:border-slate-800 dark:bg-slate-900';

  const header = document.createElement('div');
  header.className = 'mb-3 flex flex-wrap items-center justify-between gap-2';

  const nickname = document.createElement('span');
  nickname.className = 'font-semibold text-slate-900 dark:text-slate-100';
  nickname.textContent = message.nickname;

  const time = document.createElement('time');
  time.className = 'text-xs text-slate-500 dark:text-slate-400 sm:text-sm';

  // 数据库存的是 UTC 时间；加上 Z 后交给浏览器转换为本地时间。
  const createdAt = String(message.created_at);
  const dateInput = /(?:Z|[+-]\d{2}:\d{2})$/i.test(createdAt)
    ? createdAt
    : `${createdAt.replace(' ', 'T')}Z`;
  const date = new Date(dateInput);
  const validDate = !Number.isNaN(date.getTime());

  time.dateTime = validDate ? date.toISOString() : '';
  time.textContent = validDate
    ? new Intl.DateTimeFormat('zh-CN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date)
    : message.created_at;

  const content = document.createElement('p');
  content.className =
    'whitespace-pre-wrap break-words leading-7 text-slate-700 dark:text-slate-300';
  content.textContent = message.content;

  const actions = document.createElement('div');
  actions.className = 'mt-4 flex flex-wrap gap-2';

  const likeButton = document.createElement('button');
  likeButton.className =
    'rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-medium text-teal-800 transition hover:border-teal-300 hover:bg-teal-100 focus:outline-none focus:ring-2 focus:ring-teal-500/30 disabled:cursor-wait disabled:opacity-60 dark:border-teal-900 dark:bg-teal-950/60 dark:text-teal-300 dark:hover:bg-teal-950';
  likeButton.type = 'button';
  likeButton.textContent = `点赞 ${Number(message.likes) || 0}`;
  likeButton.addEventListener('click', async () => {
    likeButton.disabled = true;

    try {
      const response = await fetch(`/api/messages/${message.id}/like`, {
        method: 'POST',
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || '点赞失败。');
      }

      likeButton.textContent = `点赞 ${result.likes}`;
      setStatus('点赞成功。', false, 2000);
    } catch (error) {
      console.error('点赞失败：', error);
      setStatus(error.message || '点赞失败，请稍后重试。', true);
    } finally {
      likeButton.disabled = false;
    }
  });

  const deleteButton = document.createElement('button');
  deleteButton.className =
    'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-500/30 disabled:cursor-wait disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-rose-900 dark:hover:bg-rose-950/40 dark:hover:text-rose-300';
  deleteButton.type = 'button';
  deleteButton.textContent = '删除';
  deleteButton.addEventListener('click', async () => {
    if (!window.confirm('确定删除这条留言吗？')) {
      return;
    }

    deleteButton.disabled = true;

    try {
      const response = await fetch(`/api/messages/${message.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || '删除失败。');
      }

      setStatus('留言已删除，正在刷新列表……');
      await loadMessages();
    } catch (error) {
      console.error('删除留言失败：', error);
      setStatus(error.message || '删除失败，请稍后重试。', true);
    } finally {
      deleteButton.disabled = false;
    }
  });

  header.append(nickname, time);
  actions.append(likeButton, deleteButton);
  item.append(header, content, actions);

  if (prepend) {
    messagesList.prepend(item);
  } else {
    messagesList.append(item);
  }
}

async function loadMessages() {
  setStatus('正在加载留言……');

  try {
    const response = await fetch('/api/messages');

    if (!response.ok) {
      throw new Error(`服务器返回错误（${response.status}）`);
    }

    const messages = await response.json();
    messagesList.replaceChildren();

    if (messages.length === 0) {
      setStatus('');
      const emptyState = document.createElement('li');
      emptyState.className =
        'rounded-2xl border border-dashed border-slate-300 px-5 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400';
      emptyState.textContent = '暂时还没有留言，来发布第一条吧。';
      messagesList.append(emptyState);
      return;
    }

    for (const message of messages) {
      addMessageToPage(message);
    }

    setStatus('');
  } catch (error) {
    console.error('加载留言失败：', error);
    setStatus('暂时无法加载留言，请确认服务器正在运行后刷新页面。', true);
  }
}

form.addEventListener('submit', async (event) => {
  // 阻止浏览器默认提交表单并刷新页面。
  event.preventDefault();

  const nickname = nicknameInput.value.trim();
  const content = contentInput.value.trim();

  if (!nickname || !content) {
    setStatus('请填写昵称和留言内容。', true);
    return;
  }

  submitButton.disabled = true;
  setStatus('正在提交……');

  try {
    // fetch 向同源后端发送 POST 请求。
    const response = await fetch('/api/messages', {
      method: 'POST',
      headers: {
        // 告诉 Express：请求正文是 JSON。
        'Content-Type': 'application/json',
      },
      // 将输入内容转成 JSON 字符串，后端通过 express.json() 解析。
      body: JSON.stringify({ nickname, content }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || `服务器返回错误（${response.status}）`);
    }

    // 后端返回已保存的留言，将它插到列表最前面。
    addMessageToPage(result, true);
    form.reset();
    setStatus('留言提交成功！');
  } catch (error) {
    console.error('提交留言失败：', error);
    setStatus(error.message || '提交失败，请稍后重试。', true);
  } finally {
    submitButton.disabled = false;
  }
});

// 页面打开时先从后端加载已有留言。
loadMessages();