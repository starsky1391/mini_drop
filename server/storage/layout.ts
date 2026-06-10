import path from 'node:path';

const dataDir = path.join(process.cwd(), 'data');

export const storageLayout = {
  dataDir,
  stateFile: path.join(dataDir, 'state.json'),
  tasksDir: path.join(dataDir, 'tasks'),
  indexesDir: path.join(dataDir, 'indexes'),
  auditsDir: path.join(dataDir, 'audits'),
  reasonerDir: path.join(dataDir, 'reasoner'),
};

export function taskSnapshotPath(taskId: string) {
  return path.join(storageLayout.tasksDir, `${taskId}.json`);
}

export function taskAuditTrailPath(taskId: string) {
  return path.join(storageLayout.auditsDir, `${taskId}.jsonl`);
}

export function taskArtifactIndexPath(taskId: string) {
  return path.join(storageLayout.indexesDir, `${taskId}.artifacts.json`);
}

export function taskReasonerSnapshotPath(taskId: string) {
  return path.join(storageLayout.reasonerDir, `${taskId}.json`);
}
