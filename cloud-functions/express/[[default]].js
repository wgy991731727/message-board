if (!process.env.DATABASE_URL) {
  throw new Error(
    'EdgeOne deployment requires the DATABASE_URL environment variable.'
  );
}

const { app } = await import('../../server.js');

export default app;
