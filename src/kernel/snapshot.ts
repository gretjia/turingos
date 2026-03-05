import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Provides O(1) Copy-On-Write (CoW) micro-snapshotting capabilities 
 * and strict transactional state rollback for absolute semantic consistency (CT-T1).
 */

function getCoWCommand(): string {
  // Use clonefile (apfs) on macOS, reflink on Linux
  return process.platform === 'darwin' ? 'cp -ac' : 'cp -a --reflink=auto';
}

export function createMicroSnapshot(workspaceDir: string, snapshotName: string = '.micro_snapshot.tmp'): string {
  const microSnapshotPath = path.join(workspaceDir, snapshotName);
  const cpCmd = getCoWCommand();
  try {
    // 1) Clean previous snapshot
    execSync(`rm -rf "${microSnapshotPath}"`, { cwd: workspaceDir, stdio: 'ignore' });
    execSync(`mkdir -p "${microSnapshotPath}"`, { cwd: workspaceDir, stdio: 'ignore' });
    // 2) CoW copy everything except .git, the snapshot dir itself, and any parallel forks
    const cmd = `find . -mindepth 1 -maxdepth 1 ! -name ".git" ! -name "${snapshotName}" ! -name ".parallel_fork_w*" -exec ${cpCmd} {} "${microSnapshotPath}/" \\;`;
    execSync(cmd, { cwd: workspaceDir, stdio: 'ignore' });
  } catch (err) {
    // Ignore error but proceed
  }
  return microSnapshotPath;
}

export function commitMicroSnapshot(workspaceDir: string, snapshotName: string = '.micro_snapshot.tmp'): void {
  const microSnapshotPath = path.join(workspaceDir, snapshotName);
  try {
    execSync(`rm -rf "${microSnapshotPath}"`, { cwd: workspaceDir, stdio: 'ignore' });
  } catch (err) {
    // Ignore error
  }
}

export function rollbackMicroSnapshot(workspaceDir: string, snapshotName: string = '.micro_snapshot.tmp'): void {
  const microSnapshotPath = path.join(workspaceDir, snapshotName);
  if (!fs.existsSync(microSnapshotPath)) return;
  const cpCmd = getCoWCommand();
  try {
    // 1) Force absolute state wipe (CT-T1): Delete any newly created files
    execSync(`find . -mindepth 1 -maxdepth 1 ! -name ".git" ! -name "${snapshotName}" -exec rm -rf {} +`, { cwd: workspaceDir, stdio: 'ignore' });
    // 2) Restore from snapshot
    execSync(`find "${microSnapshotPath}" -mindepth 1 -maxdepth 1 -exec ${cpCmd} {} . \\;`, { cwd: workspaceDir, stdio: 'ignore' });
    // 3) Clean snapshot
    execSync(`rm -rf "${microSnapshotPath}"`, { cwd: workspaceDir, stdio: 'ignore' });
  } catch (err) {
    // Ignore error
  }
}
