# 留言板

## 本地运行

```powershell
npm install
npm run dev
```

本地默认使用项目根目录的 `database.db`。设置 `DATABASE_URL` 后会改用 PostgreSQL。

## 部署到 EdgeOne Pages

项目使用 EdgeOne Node.js Functions 托管 Express API，静态页面从 `public/` 发布。EdgeOne Functions 实例不适合保存本地 SQLite 文件，因此线上必须使用可从函数运行区域访问的 PostgreSQL 数据库。

1. 在 EdgeOne Pages（Makers）中导入此 Git 仓库，项目根目录选择仓库根目录。
2. 在项目构建设置中使用 `edgeone.json` 的配置：安装命令 `npm ci`，输出目录 `public`，构建 Node.js 版本 `22.11.0`。
3. 在项目环境变量中添加 `DATABASE_URL`，值为 PostgreSQL 提供商给出的连接字符串。不要把连接字符串提交到仓库。
4. 确认数据库账号有创建表的权限，然后部署项目。首次访问 API 时会自动创建 `messages` 表。

API 使用同源 `/api/*` 路径，页面与函数部署到同一 EdgeOne Pages 项目后无需额外配置跨域。

也可以使用 EdgeOne CLI 本地开发或直接部署。先登录并关联已配置 `DATABASE_URL` 的项目：

```powershell
npm install -g edgeone
edgeone login
edgeone makers link
edgeone makers dev
edgeone makers deploy
```

`edgeone makers dev` 和线上部署都需要有效的 `DATABASE_URL`。匿名预览没有项目数据库配置，留言 API 不可用。
