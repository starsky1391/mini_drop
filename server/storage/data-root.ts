import path from 'node:path';

const defaultDataRoot = path.join(process.cwd(), 'data');

export function resolveDataRoot() {
  const configured = process.env.MINI_DROP_DATA_DIR?.trim();
  return configured ? path.resolve(configured) : defaultDataRoot;
}

export function resolveDataPath(...segments: string[]) {
  return path.join(resolveDataRoot(), ...segments);
}
