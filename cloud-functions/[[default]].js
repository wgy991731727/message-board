import { createRequire } from 'node:module';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'EdgeOne deployment requires the DATABASE_URL environment variable.'
  );
}

const require = createRequire(import.meta.url);
const { app } = require('../server.js');

export default app;
