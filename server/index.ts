import express from 'express';
import path from 'node:path';
import { createCatalogRouter } from './routes/catalog-routes.js';
import { createTaskRouter } from './routes/task-routes.js';

const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 8787);

const app = express();

app.use(express.json());
app.use('/api', createCatalogRouter());
app.use('/api', createTaskRouter());

if (isProduction) {
  const clientDir = path.join(process.cwd(), 'dist', 'client');
  app.use(express.static(clientDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDir, 'index.html'));
  });
}

app.listen(port, () => {
  const mode = isProduction ? 'production' : 'development';
  console.log(`Mini-Drop API listening on http://localhost:${port} (${mode})`);
});
