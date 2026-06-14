import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveDataRoot } from '../storage/data-root.js';

const artifactRoot = path.join(resolveDataRoot(), 'artifacts');

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

export function summarizeArtifactRetention(expectedArtifacts: string[], retainedArtifacts: string[]) {
  const normalizedRetained = retainedArtifacts.map((item) => item.trim()).filter(Boolean);
  const retainedIndex = normalizedRetained.map((item) => item.toLowerCase());
  const matched = expectedArtifacts.filter((expected) =>
    retainedIndex.some((retained) => retained.includes(expected.toLowerCase()) || expected.toLowerCase().includes(retained)),
  );
  const missing = expectedArtifacts.filter((expected) => !matched.includes(expected));

  return {
    retained: normalizedRetained,
    matched,
    missing,
  };
}

export async function ensureArtifactFile(filePath: string, fallbackContent: string) {
  try {
    const stats = await fs.stat(filePath);
    if (stats.size > 0) {
      return {
        recovered: false,
        byteLength: stats.size,
      };
    }
  } catch {
    // Fall through to the placeholder write below.
  }

  await fs.writeFile(filePath, fallbackContent, 'utf8');
  return {
    recovered: true,
    byteLength: Buffer.byteLength(fallbackContent, 'utf8'),
  };
}
