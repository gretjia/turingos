import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

interface HaltStandardLock {
  version: 1;
  command: string;
  createdAt: string;
}

export interface HaltVerificationResult {
  passed: boolean;
  command: string;
  feedback: string;
  exitCode: number;
}

interface HaltVerifierConfig {
  workspaceDir: string;
  command: string;
  timeoutMs: number;
}

export class HaltVerifier {
  private readonly workspaceDir: string;
  private readonly command: string;
  private readonly timeoutMs: number;

  public static readonly DEFAULT_LOCK_FILE = '.halt-standard.lock.json';

  constructor(config: HaltVerifierConfig) {
    this.workspaceDir = config.workspaceDir;
    this.command = config.command.trim();
    this.timeoutMs = config.timeoutMs;
  }

  public static resolveLockedCommand(workspaceDir: string): string {
    const lockPath = this.resolveLockPath(workspaceDir);
    if (fs.existsSync(lockPath)) {
      const loaded = this.readLockFile(lockPath);
      if (loaded.command.trim().length === 0) {
        throw new Error(`HALT lock exists but command is empty: ${lockPath}`);
      }
      return loaded.command.trim();
    }

    const initCommand = (process.env.TURINGOS_HALT_VERIFY_CMD ?? '').trim();
    if (initCommand.length === 0) {
      throw new Error(
        [
          'HALT standard lock is missing.',
          `Create lock once via env TURINGOS_HALT_VERIFY_CMD, then restart.`,
          `Expected lock file: ${lockPath}`,
        ].join(' ')
      );
    }

    const lock: HaltStandardLock = {
      version: 1,
      command: initCommand,
      createdAt: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
    return initCommand;
  }

  public verify(): HaltVerificationResult {
    try {
      const stdout = execSync(this.command, {
        cwd: this.workspaceDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: this.timeoutMs,
        encoding: 'utf8',
      });
      return {
        passed: true,
        command: this.command,
        feedback: String(stdout ?? '').trim().slice(0, 4000) || '[HALT_VERIFY] PASS',
        exitCode: 0,
      };
    } catch (error: unknown) {
      const anyErr = error as {
        status?: number;
        stdout?: string | Buffer;
        stderr?: string | Buffer;
        message?: string;
      };
      const exitCode = typeof anyErr.status === 'number' ? anyErr.status : 1;
      const stdout = this.toText(anyErr.stdout);
      const stderr = this.toText(anyErr.stderr);
      const message = (anyErr.message ?? 'HALT verification failed').trim();
      const feedback = [message, stdout, stderr].filter((line) => line.length > 0).join('\n').slice(0, 4000);
      return {
        passed: false,
        command: this.command,
        feedback: feedback.length > 0 ? feedback : '[HALT_VERIFY] FAIL',
        exitCode,
      };
    }
  }

  private toText(value: string | Buffer | undefined): string {
    if (typeof value === 'string') {
      return value.trim();
    }
    if (Buffer.isBuffer(value)) {
      return value.toString('utf8').trim();
    }
    return '';
  }

  private static resolveLockPath(workspaceDir: string): string {
    const envPath = (process.env.TURINGOS_HALT_STANDARD_LOCK_FILE ?? '').trim();
    if (envPath.length > 0) {
      return path.isAbsolute(envPath) ? envPath : path.resolve(workspaceDir, envPath);
    }
    return path.resolve(workspaceDir, this.DEFAULT_LOCK_FILE);
  }

  private static readLockFile(lockPath: string): HaltStandardLock {
    const raw = fs.readFileSync(lockPath, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid HALT lock JSON (${lockPath}): ${message}`);
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error(`Invalid HALT lock payload (${lockPath}): expected object`);
    }
    const record = parsed as Partial<HaltStandardLock>;
    if (record.version !== 1 || typeof record.command !== 'string' || typeof record.createdAt !== 'string') {
      throw new Error(`Invalid HALT lock fields (${lockPath})`);
    }
    return {
      version: 1,
      command: record.command,
      createdAt: record.createdAt,
    };
  }
}
