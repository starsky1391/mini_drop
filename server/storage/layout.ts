import path from 'node:path';
import { resolveDataPath, resolveDataRoot } from './data-root.js';

const dataDir = resolveDataRoot();

export const storageLayout = {
  dataDir,
  stateFile: resolveDataPath('state.json'),
  tasksDir: resolveDataPath('tasks'),
  agentsDir: resolveDataPath('agents'),
  runStateDir: resolveDataPath('run-states'),
  stagedDir: resolveDataPath('staged-uploads'),
  slicesDir: resolveDataPath('continuous-slices'),
  indexesDir: resolveDataPath('indexes'),
  auditsDir: resolveDataPath('audits'),
  reasonerDir: resolveDataPath('reasoner'),
};

export function taskSnapshotPath(taskId: string) {
  return path.join(storageLayout.tasksDir, `${taskId}.json`);
}

export function agentSnapshotPath(agentId: string) {
  return path.join(storageLayout.agentsDir, `${agentId}.json`);
}

export function taskRunStatePath(taskId: string) {
  return path.join(storageLayout.runStateDir, `${taskId}.json`);
}

export function taskStagedUploadPath(taskId: string) {
  return path.join(storageLayout.stagedDir, `${taskId}.json`);
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

export function taskContinuousSlicesPath(taskId: string) {
  return path.join(storageLayout.slicesDir, `${taskId}.json`);
}

export function continuousSliceIndexPath() {
  return resolveDataPath('indexes', 'continuous-slices.json');
}

export function taskIndexPath() {
  return resolveDataPath('indexes', 'tasks.json');
}

export function auditIndexPath() {
  return resolveDataPath('indexes', 'audits.json');
}

export function agentIndexPath() {
  return resolveDataPath('indexes', 'agents.json');
}
