import fs from 'node:fs/promises';
import path from 'node:path';
import { ContractCheckResult, IExecutionContract } from '../kernel/types.js';

interface ExecutionContractFile {
  enabled?: boolean;
  progress_file?: string;
  ordered_steps?: string[];
  required_files?: string[];
}

interface ParsedDoneSteps {
  steps: string[];
}

export class FileExecutionContract implements IExecutionContract {
  public static readonly FILE_NAME = '.turingos.contract.json';

  private constructor(private workspaceDir: string, private config: ExecutionContractFile) {}

  public static async fromWorkspace(workspaceDir: string): Promise<FileExecutionContract | null> {
    const contractPath = path.join(workspaceDir, FileExecutionContract.FILE_NAME);
    let raw: string;
    try {
      raw = await fs.readFile(contractPath, 'utf-8');
    } catch {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as ExecutionContractFile;
      return new FileExecutionContract(workspaceDir, parsed);
    } catch {
      return null;
    }
  }

  public async checkProgress(): Promise<ContractCheckResult> {
    if (this.config.enabled === false) {
      return { ok: true };
    }

    const ordered = this.orderedSteps();
    if (ordered.length === 0) {
      return { ok: true };
    }

    const done = await this.readDoneSteps();

    for (let i = 0; i < done.steps.length; i += 1) {
      if (i >= ordered.length) {
        return {
          ok: false,
          reason: `Progress exceeds plan length at index ${i + 1}.`,
        };
      }

      if (done.steps[i] !== ordered[i]) {
        return {
          ok: false,
          reason: `Out-of-order progress at index ${i + 1}. Expected DONE:${ordered[i]} but got DONE:${done.steps[i]}.`,
        };
      }
    }

    return { ok: true };
  }

  public async checkHalt(): Promise<ContractCheckResult> {
    if (this.config.enabled === false) {
      return { ok: true };
    }

    const ordered = this.orderedSteps();
    if (ordered.length > 0) {
      const done = await this.readDoneSteps();

      if (done.steps.length !== ordered.length) {
        return {
          ok: false,
          reason: `Plan incomplete for HALT. done=${done.steps.length} required=${ordered.length}.`,
        };
      }

      for (let i = 0; i < ordered.length; i += 1) {
        if (done.steps[i] !== ordered[i]) {
          return {
            ok: false,
            reason: `Plan mismatch for HALT at step ${i + 1}. Expected DONE:${ordered[i]} but got DONE:${done.steps[i]}.`,
          };
        }
      }
    }

    const requiredFiles = this.requiredFiles();
    for (const file of requiredFiles) {
      const exists = await this.fileExists(file);
      if (!exists) {
        return { ok: false, reason: `Required file missing for HALT: ${file}` };
      }
    }

    return { ok: true };
  }

  private orderedSteps(): string[] {
    return (this.config.ordered_steps ?? []).filter((step): step is string => typeof step === 'string');
  }

  private requiredFiles(): string[] {
    return (this.config.required_files ?? []).filter((item): item is string => typeof item === 'string');
  }

  private progressPath(): string {
    return this.config.progress_file ?? 'plan/progress.log';
  }

  private async readDoneSteps(): Promise<ParsedDoneSteps> {
    const progressFile = this.resolveWorkspacePath(this.progressPath());
    let raw = '';
    try {
      raw = await fs.readFile(progressFile, 'utf-8');
    } catch {
      return { steps: [] };
    }

    const lines = raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const steps: string[] = [];
    for (const line of lines) {
      if (!line.startsWith('DONE:')) {
        continue;
      }

      const step = line.slice('DONE:'.length).trim();
      if (step.length === 0) {
        continue;
      }
      steps.push(step);
    }

    return { steps };
  }

  private resolveWorkspacePath(pointer: string): string {
    const normalized = pointer.replace(/^\.\//, '');
    const resolved = path.resolve(this.workspaceDir, normalized);
    const workspaceRoot = path.resolve(this.workspaceDir);

    if (resolved !== workspaceRoot && !resolved.startsWith(`${workspaceRoot}${path.sep}`)) {
      throw new Error(`Path escapes workspace: ${pointer}`);
    }

    return resolved;
  }

  private async fileExists(pointer: string): Promise<boolean> {
    const target = this.resolveWorkspacePath(pointer);
    try {
      await fs.access(target);
      return true;
    } catch {
      return false;
    }
  }
}
