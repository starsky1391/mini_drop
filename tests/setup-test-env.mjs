import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (!process.env.MINI_DROP_DATA_DIR) {
  const base = mkdtempSync(path.join(os.tmpdir(), 'mini-drop-tests-'));
  process.env.MINI_DROP_DATA_DIR = base;
}
