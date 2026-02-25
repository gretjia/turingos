import { exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { IPhysicalManifold, Pointer, Slice } from '../kernel/types.js';

export interface LocalManifoldOptions {
  timeoutMs?: number;
}

export class LocalManifold implements IPhysicalManifold {
  private timeoutMs: number;

  constructor(private workspaceDir: string, options: LocalManifoldOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 120_000;
    fs.mkdirSync(this.workspaceDir, { recursive: true });
  }

  public async observe(pointer: Pointer): Promise<Slice> {
    const trimmed = pointer.trim();

    if (trimmed.length === 0) {
      throw new Error('Pointer is empty.');
    }

    if (trimmed.startsWith('sys://')) {
      return this.observeSystemChannel(trimmed);
    }

    if (trimmed.startsWith('$')) {
      const command = trimmed.replace(/^\$\s*/, '');
      return this.executeCommandSlice(command);
    }

    const filePath = this.resolveWorkspacePath(trimmed);
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${trimmed}`);
    }

    return fs.readFileSync(filePath, 'utf-8');
  }

  public async interfere(pointer: Pointer, payload: string): Promise<void> {
    const trimmed = pointer.trim();

    if (trimmed.startsWith('sys://append/')) {
      const targetPointer = trimmed.slice('sys://append/'.length).trim();
      if (targetPointer.length === 0) {
        throw new Error('Append target is empty.');
      }

      const filePath = this.resolveWorkspacePath(targetPointer);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const normalizedLine = payload.trimEnd();
      if (normalizedLine.length === 0) {
        return;
      }

      let lastNonEmptyLine = '';
      if (fs.existsSync(filePath)) {
        const existing = fs
          .readFileSync(filePath, 'utf-8')
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
        lastNonEmptyLine = existing[existing.length - 1] ?? '';
      }

      if (lastNonEmptyLine === normalizedLine) {
        throw new Error(`Duplicate append blocked for ${targetPointer}: "${normalizedLine}"`);
      }

      fs.appendFileSync(filePath, `${normalizedLine}\n`, 'utf-8');
      return;
    }

    if (trimmed.startsWith('sys://')) {
      return;
    }

    // Commands are observed through '$ ...', not written back to tape cells.
    if (trimmed.startsWith('$')) {
      return;
    }

    const filePath = this.resolveWorkspacePath(trimmed);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, payload, 'utf-8');
  }

  private resolveWorkspacePath(pointer: string): string {
    const normalized = pointer.replace(/^\.\//, '');
    const resolved = path.resolve(this.workspaceDir, normalized);
    const workspaceRoot = path.resolve(this.workspaceDir);

    if (resolved !== workspaceRoot && !resolved.startsWith(`${workspaceRoot}${path.sep}`)) {
      throw new Error(`Pointer escapes workspace: ${pointer}`);
    }

    return resolved;
  }

  private observeSystemChannel(pointer: string): string {
    const [base, query = ''] = pointer.split('?', 2);
    const params = new URLSearchParams(query);
    const details = params.get('details');

    if (base.startsWith('sys://append/')) {
      const target = base.slice('sys://append/'.length);
      let current = '(empty)';
      try {
        const targetPath = this.resolveWorkspacePath(target);
        if (fs.existsSync(targetPath)) {
          const raw = fs.readFileSync(targetPath, 'utf-8').trimEnd();
          current = raw.length > 0 ? raw : '(empty)';
        }
      } catch {
        current = '(unreadable target)';
      }

      return [
        `[SYSTEM_CHANNEL] ${base}`,
        `Append target: ${target}`,
        '[CURRENT_CONTENT]',
        current,
        'Action: append exactly one NEW DONE line for the next unfinished step, then move to the next work pointer.',
      ].join('\n');
    }

    if (details) {
      return [`[SYSTEM_CHANNEL] ${base}`, '[DETAILS]', details].join('\n');
    }

    return `[SYSTEM_CHANNEL] ${base}`;
  }

  private async executeCommandSlice(command: string): Promise<string> {
    if (command.length === 0) {
      return ['[COMMAND] (empty)', '[EXIT_CODE] 1', '[STDOUT]', '', '[STDERR]', 'Command is empty.'].join('\n');
    }

    return new Promise((resolve) => {
      exec(
        command,
        {
          cwd: this.workspaceDir,
          timeout: this.timeoutMs,
          killSignal: 'SIGKILL',
          maxBuffer: 1024 * 1024,
        },
        (error, stdout, stderr) => {
          const cleanStdout = stdout.trimEnd();
          const cleanStderr = stderr.trimEnd();

          if (error) {
            const anyErr = error as Error & { code?: number | string; killed?: boolean; signal?: string };
            const exitCode = typeof anyErr.code === 'number' ? anyErr.code : 1;
            const timeoutNotice = anyErr.killed ? '[TIMEOUT] Command was killed due to timeout.' : '';
            const stderrPayload = cleanStderr || anyErr.message;

            resolve(
              this.formatCommandSlice(command, exitCode, cleanStdout, [timeoutNotice, stderrPayload].filter(Boolean).join('\n'))
            );
            return;
          }

          resolve(this.formatCommandSlice(command, 0, cleanStdout, cleanStderr));
        }
      );
    });
  }

  private formatCommandSlice(command: string, exitCode: number, stdout: string, stderr: string): string {
    return [
      `[COMMAND] ${command}`,
      `[EXIT_CODE] ${exitCode}`,
      '[STDOUT]',
      stdout,
      '[STDERR]',
      stderr,
    ].join('\n');
  }
}
