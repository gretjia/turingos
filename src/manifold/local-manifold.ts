import { exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { IPhysicalManifold, Pointer, Slice } from '../kernel/types.js';

export interface LocalManifoldOptions {
  timeoutMs?: number;
  maxSliceChars?: number;
}

export class LocalManifold implements IPhysicalManifold {
  private timeoutMs: number;
  private maxSliceChars: number;
  private callStackFile: string;

  constructor(private workspaceDir: string, options: LocalManifoldOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.maxSliceChars = options.maxSliceChars ?? 3000;
    fs.mkdirSync(this.workspaceDir, { recursive: true });
    this.callStackFile = path.join(this.workspaceDir, '.callstack.json');
    if (!fs.existsSync(this.callStackFile)) {
      fs.writeFileSync(this.callStackFile, '[]\n', 'utf-8');
    }
  }

  public async observe(pointer: Pointer): Promise<Slice> {
    const trimmed = pointer.trim();

    if (trimmed.length === 0) {
      throw new Error('Pointer is empty.');
    }

    if (trimmed.startsWith('sys://')) {
      return this.guardSlice(this.observeSystemChannel(trimmed), `system:${trimmed}`);
    }

    if (trimmed.startsWith('$')) {
      const command = trimmed.replace(/^\$\s*/, '');
      return this.executeCommandSlice(command);
    }

    const filePath = this.resolveWorkspacePath(trimmed);
    if (!fs.existsSync(filePath)) {
      throw new Error(this.buildPageFaultDetails(trimmed, filePath));
    }

    return this.guardSlice(fs.readFileSync(filePath, 'utf-8'), `file:${trimmed}`);
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

    if (trimmed.startsWith('sys://replace/')) {
      const targetPointer = trimmed.slice('sys://replace/'.length).trim();
      if (targetPointer.length === 0) {
        throw new Error('Replace target is empty.');
      }

      this.applyReplaceSyscall(targetPointer, payload);
      return;
    }

    if (trimmed === 'sys://callstack') {
      this.applyCallStackSyscall(payload);
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

    if (base === 'sys://callstack') {
      return this.renderCallStackSnapshot(base);
    }

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

    if (base.startsWith('sys://replace/')) {
      const target = base.slice('sys://replace/'.length);
      return [
        `[SYSTEM_CHANNEL] ${base}`,
        `Replace target: ${target}`,
        '[REPLACE_PAYLOAD_FORMAT]',
        '{"search":"<exact-substring>","replace":"<new-substring>","all":false}',
        'or plain text payload (treated as full-file overwrite fallback).',
        'Action: use sys://replace for surgical patch instead of full-file overwrite.',
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
    const rawSlice = [
      `[COMMAND] ${command}`,
      `[EXIT_CODE] ${exitCode}`,
      '[STDOUT]',
      stdout,
      '[STDERR]',
      stderr,
    ].join('\n');

    return this.guardSlice(rawSlice, `command:${command}`);
  }

  private buildPageFaultDetails(pointer: string, filePath: string): string {
    const parentDir = path.dirname(filePath);
    const relativeParent = path.relative(this.workspaceDir, parentDir).replace(/\\/g, '/') || '.';

    if (fs.existsSync(parentDir)) {
      try {
        const entries = fs.readdirSync(parentDir).slice(0, 20);
        const listing = entries.length > 0 ? entries.join(', ') : '(empty)';
        return `File not found: ${pointer}. Parent=${relativeParent}. Entries=${listing}`;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return `File not found: ${pointer}. Parent=${relativeParent}. Directory listing failed: ${message}`;
      }
    }

    return `File not found: ${pointer}. Parent directory does not exist: ${relativeParent}`;
  }

  private guardSlice(slice: string, source: string): string {
    if (slice.length <= this.maxSliceChars) {
      return slice;
    }

    const truncated = slice.slice(0, this.maxSliceChars);
    return [
      truncated,
      '',
      '[OS_TRAP: MMU_TRUNCATED]',
      `Source=${source}`,
      `OriginalChars=${slice.length}`,
      `TruncatedTo=${this.maxSliceChars}`,
      'Action: Narrow I/O scope with grep/head/tail/sed and retry.',
    ].join('\n');
  }

  private renderCallStackSnapshot(channel: string): string {
    const stack = this.readCallStack();
    const top = stack.length > 0 ? stack[stack.length - 1] : '(empty)';
    const frames = stack.length > 0 ? stack.map((item, idx) => `${idx + 1}. ${item}`).join('\n') : '(empty)';

    return [
      `[SYSTEM_CHANNEL] ${channel}`,
      `[CALL_STACK_DEPTH] ${stack.length}`,
      `[CALL_STACK_TOP] ${top}`,
      '[CALL_STACK]',
      frames,
      'Action: use stack_op PUSH/POP/NOP and stack_payload in JSON syscall.',
    ].join('\n');
  }

  private applyCallStackSyscall(payload: string): void {
    const instruction = payload.trim();
    const stack = this.readCallStack();

    if (instruction.length === 0 || instruction.toUpperCase() === 'NOP') {
      return;
    }

    if (instruction.toUpperCase() === 'POP') {
      if (stack.length > 0) {
        stack.pop();
        this.writeCallStack(stack);
      }
      return;
    }

    const pushMatch = instruction.match(/^PUSH\s*:?\s*(.+)$/is);
    if (pushMatch?.[1]) {
      const task = pushMatch[1].trim().replace(/\s+/g, ' ');
      if (task.length === 0) {
        throw new Error('PUSH payload is empty.');
      }

      stack.push(task.slice(0, 200));
      this.writeCallStack(stack);
      return;
    }

    throw new Error(`Invalid callstack syscall payload: "${instruction}"`);
  }

  private applyReplaceSyscall(targetPointer: string, payload: string): void {
    const targetPath = this.resolveWorkspacePath(targetPointer);
    if (!fs.existsSync(targetPath)) {
      throw new Error(`Replace target does not exist: ${targetPointer}`);
    }

    const raw = fs.readFileSync(targetPath, 'utf-8');
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(payload);
    } catch {
      const fallback = payload;
      if (fallback.length === 0) {
        throw new Error('Replace payload is empty.');
      }
      if (fallback === raw) {
        throw new Error(`Replace fallback produced no changes for ${targetPointer}.`);
      }
      fs.writeFileSync(targetPath, fallback, 'utf-8');
      return;
    }

    if (typeof parsed === 'string') {
      if (parsed === raw) {
        throw new Error(`Replace string payload produced no changes for ${targetPointer}.`);
      }
      fs.writeFileSync(targetPath, parsed, 'utf-8');
      return;
    }

    const content = (parsed as { content?: unknown }).content;
    if (typeof content === 'string') {
      if (content === raw) {
        throw new Error(`Replace content payload produced no changes for ${targetPointer}.`);
      }
      fs.writeFileSync(targetPath, content, 'utf-8');
      return;
    }

    const search = (parsed as { search?: unknown }).search;
    const replace = (parsed as { replace?: unknown }).replace;
    const all = (parsed as { all?: unknown }).all;

    if (typeof search !== 'string' || search.length === 0) {
      throw new Error('Replace payload requires non-empty string field "search".');
    }
    if (typeof replace !== 'string') {
      throw new Error('Replace payload requires string field "replace".');
    }
    if (!raw.includes(search)) {
      throw new Error(`Replace search token not found in ${targetPointer}.`);
    }

    const next = all === true ? raw.split(search).join(replace) : raw.replace(search, replace);
    if (next === raw) {
      throw new Error(`Replace produced no changes for ${targetPointer}.`);
    }

    fs.writeFileSync(targetPath, next, 'utf-8');
  }

  private readCallStack(): string[] {
    try {
      const raw = fs.readFileSync(this.callStackFile, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
    } catch {
      return [];
    }
  }

  private writeCallStack(stack: string[]): void {
    fs.writeFileSync(this.callStackFile, `${JSON.stringify(stack, null, 2)}\n`, 'utf-8');
  }
}
