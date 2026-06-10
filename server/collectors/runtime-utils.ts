import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const artifactRoot = path.join(process.cwd(), 'data', 'artifacts');

export async function ensureArtifactDir(taskId: string) {
  const dir = path.join(artifactRoot, taskId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export function artifactPath(taskId: string, name: string) {
  return path.join(artifactRoot, taskId, name);
}

export async function writeArtifact(taskId: string, name: string, content: string) {
  const dir = await ensureArtifactDir(taskId);
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, content, 'utf8');
  return filePath;
}

export async function writeJsonArtifact(taskId: string, name: string, content: unknown) {
  return writeArtifact(taskId, name, JSON.stringify(content, null, 2));
}

export function artifactLabel(prefix: string, kind: string) {
  return `${prefix}-${kind}-${randomUUID().slice(0, 8)}`;
}
