import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.UI_TEST_PORT || 4178);
const app = express();

app.use(express.static(repoRoot, { index: false }));

const server = app.listen(port, '127.0.0.1', () => {
  console.log(`UI test server listening on http://127.0.0.1:${port}`);
});

const close = () => server.close(() => process.exit(0));
process.on('SIGINT', close);
process.on('SIGTERM', close);
