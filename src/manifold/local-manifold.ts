import { exec, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { IPhysicalManifold, Pointer, RunqueueStatus, RunqueueTargetPos, Slice } from '../kernel/types.js';

export interface LocalManifoldOptions {
  timeoutMs?: number;
  maxSliceChars?: number;
  enableChaos?: boolean;
  chaosExecTimeoutRate?: number;
  chaosWriteDenyRate?: number;
  chaosLogFloodRate?: number;
  chaosLogFloodChars?: number;
  logBackpressureBytes?: number | string;
  logMaxTailLines?: number | string;
  logFloodSummaryMode?: 'tail' | 'grep' | 'hash' | string;
}

type CapabilityAccess = 'r' | 'w' | 'rw';

interface SemanticCapabilityEntry {
  handle: string;
  targetPointer: string;
  access: CapabilityAccess;
  issuedAt: string;
}

interface RunQueueTask {
  task_id: string;
  status: RunqueueStatus;
  objective: string;
  scratchpad: string;
  created_at: string;
  updated_at: string;
}

export class LocalManifold implements IPhysicalManifold {
  private timeoutMs: number;
  private maxSliceChars: number;
  private pageSizeChars: number;
  private readonly maxCallStackDepth = 64;
  private callStackFile: string;
  private capabilityFile: string;
  private readonly pageStore = new Map<string, { source: string; pages: string[]; createdAt: string }>();
  private readonly maxPageStoreEntries = 128;
  private readonly capabilityStore = new Map<string, SemanticCapabilityEntry>();
  private readonly capabilityOrder: string[] = [];
  private readonly maxCapabilities = 2048;
  private readonly chaosEnabled: boolean;
  private readonly chaosExecTimeoutRate: number;
  private readonly chaosWriteDenyRate: number;
  private readonly chaosLogFloodRate: number;
  private readonly chaosLogFloodChars: number;
  private readonly logBackpressureBytes: number;
  private readonly logMaxTailLines: number;
  private readonly logFloodSummaryMode: 'tail' | 'grep' | 'hash';

  constructor(private workspaceDir: string, options: LocalManifoldOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.maxSliceChars = options.maxSliceChars ?? 3000;
    this.pageSizeChars = this.maxSliceChars;
    fs.mkdirSync(this.workspaceDir, { recursive: true });
    this.callStackFile = path.join(this.workspaceDir, '.callstack.json');
    this.capabilityFile = path.join(this.workspaceDir, '.vfd_caps.json');
    this.chaosEnabled = options.enableChaos ?? false;
    this.chaosExecTimeoutRate = this.parseChaosRate(options.chaosExecTimeoutRate, 0.1);
    this.chaosWriteDenyRate = this.parseChaosRate(options.chaosWriteDenyRate, 0.05);
    this.chaosLogFloodRate = this.parseChaosRate(options.chaosLogFloodRate, 0.1);
    this.chaosLogFloodChars = this.parseChaosLength(options.chaosLogFloodChars, 50_000);
    this.logBackpressureBytes = this.parsePositiveInt(
      options.logBackpressureBytes ?? process.env.TURINGOS_LOG_BACKPRESSURE_BYTES,
      32_768
    );
    this.logMaxTailLines = this.parsePositiveInt(
      options.logMaxTailLines ?? process.env.TURINGOS_LOG_MAX_TAIL_LINES,
      120
    );
    this.logFloodSummaryMode = this.parseLogFloodSummaryMode(
      options.logFloodSummaryMode ?? process.env.TURINGOS_LOG_FLOOD_SUMMARY_MODE,
      'tail'
    );
    if (!fs.existsSync(this.callStackFile)) {
      fs.writeFileSync(this.callStackFile, '[]\n', 'utf-8');
    }
    this.loadCapabilities();
  }

  public async observe(pointer: Pointer): Promise<Slice> {
    const trimmed = pointer.trim();

    if (trimmed.length === 0) {
      throw new Error('Pointer is empty.');
    }

    if (trimmed.startsWith('sys://cap/')) {
      return this.guardSlice(this.observeCapabilityChannel(trimmed), `system:${trimmed}`);
    }

    const resolvedPointer = trimmed.startsWith('vfd://') ? this.resolveCapabilityHandle(trimmed, 'r') : trimmed;

    if (resolvedPointer.startsWith('sys://page/')) {
      return this.observePagedChannel(resolvedPointer);
    }

    if (resolvedPointer.startsWith('sys://')) {
      return this.guardSlice(this.observeSystemChannel(resolvedPointer), `system:${resolvedPointer}`);
    }

    if (resolvedPointer.startsWith('$')) {
      const command = resolvedPointer.replace(/^\$\s*/, '');
      return this.executeCommandSlice(command);
    }

    const filePath = this.resolveWorkspacePath(resolvedPointer);
    if (!fs.existsSync(filePath)) {
      throw new Error(this.buildPageFaultDetails(resolvedPointer, filePath));
    }

    return this.guardSlice(fs.readFileSync(filePath, 'utf-8'), `file:${resolvedPointer}`);
  }

  public async interfere(pointer: Pointer, payload: string): Promise<void> {
    const trimmed = pointer.trim();
    if (trimmed.length === 0) {
      throw new Error('Pointer is empty.');
    }

    if (trimmed.startsWith('sys://cap/')) {
      // Capability channels are read-only control planes.
      throw new Error(`Capability control channel is read-only: ${trimmed}`);
    }

    const resolvedPointer = trimmed.startsWith('vfd://') ? this.resolveCapabilityHandle(trimmed, 'w') : trimmed;

    if (resolvedPointer.startsWith('sys://append/')) {
      const targetPointer = resolvedPointer.slice('sys://append/'.length).trim();
      if (targetPointer.length === 0) {
        throw new Error('Append target is empty.');
      }
      this.maybeInjectWritePermissionTrap(targetPointer, payload, 'append');

      const filePath = this.resolveWorkspacePath(targetPointer);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const normalizedLine = payload.trimEnd();
      if (normalizedLine.length === 0) {
        return;
      }

      let lastNonEmptyLine = '';
      let existingRaw = '';
      if (fs.existsSync(filePath)) {
        existingRaw = fs.readFileSync(filePath, 'utf-8');
        const existing = existingRaw
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
        lastNonEmptyLine = existing[existing.length - 1] ?? '';
      }

      if (lastNonEmptyLine === normalizedLine) {
        throw new Error(`Duplicate append blocked for ${targetPointer}: "${normalizedLine}"`);
      }

      const needsLeadingNewline =
        existingRaw.length > 0 && !existingRaw.endsWith('\n');
      const prefix = needsLeadingNewline ? '\n' : '';

      fs.appendFileSync(filePath, `${prefix}${normalizedLine}\n`, 'utf-8');
      return;
    }

    if (resolvedPointer.startsWith('sys://replace/')) {
      const targetPointer = resolvedPointer.slice('sys://replace/'.length).trim();
      if (targetPointer.length === 0) {
        throw new Error('Replace target is empty.');
      }
      this.maybeInjectWritePermissionTrap(targetPointer, payload, 'write');

      this.applyReplaceSyscall(targetPointer, payload);
      return;
    }

    if (resolvedPointer === 'sys://callstack') {
      this.applyCallStackSyscall(payload);
      return;
    }

    if (resolvedPointer.startsWith('sys://')) {
      return;
    }

    // Commands are observed through '$ ...', not written back to tape cells.
    if (resolvedPointer.startsWith('$')) {
      return;
    }

    const filePath = this.resolveWorkspacePath(resolvedPointer);
    this.maybeInjectWritePermissionTrap(resolvedPointer, payload, 'write');
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

    if (base === 'sys://git/log') {
      return this.observeGitLogChannel(base, params);
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
    if (this.shouldInjectChaos(this.chaosExecTimeoutRate)) {
      return this.formatCommandSlice(command, 124, '', '[FATAL] PROCESS_TIMEOUT: Execution hanging.');
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
            const backpressured = this.applyCommandBackpressure(
              command,
              cleanStdout,
              [timeoutNotice, stderrPayload].filter(Boolean).join('\n')
            );

            resolve(
              this.formatCommandSlice(
                command,
                exitCode,
                backpressured.stdout,
                backpressured.stderr,
                backpressured.metaLines
              )
            );
            return;
          }

          let stdoutForSlice = cleanStdout;
          if (this.shouldInjectChaos(this.chaosLogFloodRate)) {
            stdoutForSlice = `${stdoutForSlice}\n${this.buildChaosLogFlood(this.chaosLogFloodChars)}`;
          }
          const backpressured = this.applyCommandBackpressure(command, stdoutForSlice, cleanStderr);
          resolve(
            this.formatCommandSlice(
              command,
              0,
              backpressured.stdout,
              backpressured.stderr,
              backpressured.metaLines
            )
          );
        }
      );
    });
  }

  private shouldInjectChaos(rate: number): boolean {
    if (!this.chaosEnabled || !Number.isFinite(rate) || rate <= 0) {
      return false;
    }
    return Math.random() < rate;
  }

  private parseChaosRate(raw: number | string | undefined, fallback: number): number {
    if (typeof raw === 'number') {
      if (!Number.isFinite(raw)) {
        return fallback;
      }
      if (raw <= 0) {
        return 0;
      }
      if (raw >= 1) {
        return 1;
      }
      return raw;
    }
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      return fallback;
    }
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    if (parsed <= 0) {
      return 0;
    }
    if (parsed >= 1) {
      return 1;
    }
    return parsed;
  }

  private parseChaosLength(raw: number | string | undefined, fallback: number): number {
    if (typeof raw === 'number') {
      if (!Number.isFinite(raw) || raw <= 0) {
        return fallback;
      }
      return Math.floor(raw);
    }
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      return fallback;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    return parsed;
  }

  private parsePositiveInt(raw: number | string | undefined, fallback: number): number {
    if (typeof raw === 'number') {
      if (!Number.isFinite(raw) || raw <= 0) {
        return fallback;
      }
      return Math.floor(raw);
    }
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      return fallback;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    return parsed;
  }

  private parseLogFloodSummaryMode(
    raw: string | undefined,
    fallback: 'tail' | 'grep' | 'hash'
  ): 'tail' | 'grep' | 'hash' {
    if (typeof raw !== 'string') {
      return fallback;
    }
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'tail' || normalized === 'grep' || normalized === 'hash') {
      return normalized;
    }
    return fallback;
  }

  private maybeInjectWritePermissionTrap(
    pointer: string,
    payload?: string,
    mode: 'write' | 'append' = 'write'
  ): void {
    if (!this.shouldInjectChaos(this.chaosWriteDenyRate)) {
      return;
    }

    // Simulate dirty physical residue before permission failure.
    if (typeof payload === 'string' && payload.length > 0) {
      try {
        const filePath = this.resolveWorkspacePath(pointer);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const partialChars = Math.max(1, Math.floor(payload.length * 0.1));
        const partialPayload = payload.slice(0, partialChars);
        if (mode === 'append') {
          fs.appendFileSync(filePath, partialPayload, 'utf-8');
        } else {
          fs.writeFileSync(filePath, partialPayload, 'utf-8');
        }
      } catch {
        // best-effort chaos injection; permission trap still fires below
      }
    }

    throw new Error(`[OS_TRAP] EACCES: Permission denied. pointer=${pointer}; partial_write=yes`);
  }

  private buildChaosLogFlood(length: number): string {
    const targetLength = Number.isFinite(length) && length > 0 ? Math.floor(length) : 50_000;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?/';
    let out = '';
    while (out.length < targetLength) {
      const idx = Math.floor(Math.random() * alphabet.length);
      out += alphabet[idx];
    }
    return out.slice(0, targetLength);
  }

  private applyCommandBackpressure(
    command: string,
    stdout: string,
    stderr: string
  ): { stdout: string; stderr: string; metaLines: string[] } {
    const originalBytes = Buffer.byteLength(stdout, 'utf-8') + Buffer.byteLength(stderr, 'utf-8');
    if (originalBytes <= this.logBackpressureBytes) {
      return { stdout, stderr, metaLines: [] };
    }

    let throttledStdout = stdout;
    let throttledStderr = stderr;
    if (this.logFloodSummaryMode === 'grep') {
      throttledStdout = this.grepSuspiciousLines(stdout, this.logMaxTailLines);
      throttledStderr = this.grepSuspiciousLines(stderr, this.logMaxTailLines);
    } else {
      throttledStdout = this.takeTailLines(stdout, this.logMaxTailLines);
      throttledStderr = this.takeTailLines(stderr, this.logMaxTailLines);
    }

    if (this.logFloodSummaryMode === 'hash') {
      const stdoutHash = createHash('sha256').update(stdout).digest('hex').slice(0, 16);
      const stderrHash = createHash('sha256').update(stderr).digest('hex').slice(0, 16);
      throttledStdout = `[HASH] sha256:${stdoutHash}\n${this.takeTailLines(stdout, Math.max(16, Math.floor(this.logMaxTailLines / 2)))}`;
      throttledStderr = `[HASH] sha256:${stderrHash}\n${this.takeTailLines(stderr, Math.max(16, Math.floor(this.logMaxTailLines / 2)))}`;
    }

    const keptBytes = Buffer.byteLength(throttledStdout, 'utf-8') + Buffer.byteLength(throttledStderr, 'utf-8');
    const commandHint = command.trim().length > 0 ? command.trim() : '(unknown)';
    const metaLines = [
      '[OS_TRAP: LOG_FLOOD]',
      `[LOG_BACKPRESSURE] original_bytes=${originalBytes} kept_bytes=${keptBytes} threshold=${this.logBackpressureBytes} mode=${this.logFloodSummaryMode}`,
      `[LOG_THROTTLE] tail_lines=${this.logMaxTailLines}`,
      `[ACTION_HINT] Prefer SYS_EXEC(\"tail -n ${Math.max(20, Math.floor(this.logMaxTailLines / 2))} <log>\") or SYS_EXEC(\"grep -nE 'error|fail|panic' <log>\") before SYS_HALT. source_command=${commandHint}`,
    ];
    return { stdout: throttledStdout, stderr: throttledStderr, metaLines };
  }

  private takeTailLines(text: string, maxLines: number): string {
    if (text.length === 0) {
      return text;
    }
    const lines = text.split('\n');
    if (lines.length > 1) {
      return lines.slice(-maxLines).join('\n');
    }
    const charBudget = Math.max(1024, Math.floor(this.logBackpressureBytes / 3));
    return text.slice(-charBudget);
  }

  private grepSuspiciousLines(text: string, maxLines: number): string {
    if (text.length === 0) {
      return text;
    }
    const lines = text.split('\n');
    const suspicious = lines.filter((line) => /error|fail|panic|exception|denied|timeout|trace|fatal/i.test(line));
    const merged = suspicious.length > 0 ? suspicious : lines;
    return merged.slice(-maxLines).join('\n');
  }

  private formatCommandSlice(
    command: string,
    exitCode: number,
    stdout: string,
    stderr: string,
    metaLines: string[] = []
  ): string {
    const rawSlice = [
      `[COMMAND] ${command}`,
      `[EXIT_CODE] ${exitCode}`,
      ...metaLines,
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

    const token = this.storePagedSlice(source, slice);
    return this.renderPagedSlice(token, 1);
  }

  private observePagedChannel(pointer: string): string {
    const [base, query = ''] = pointer.split('?', 2);
    const token = base.slice('sys://page/'.length).trim();
    if (token.length === 0) {
      return '[OS_TRAP: PAGE_FAULT] Missing page token in sys://page channel.';
    }

    const params = new URLSearchParams(query);
    const pageParam = params.get('p') ?? params.get('page') ?? '1';
    const requested = Number.parseInt(pageParam, 10);
    const pageNumber = Number.isFinite(requested) && requested > 0 ? requested : 1;
    return this.renderPagedSlice(token, pageNumber);
  }

  private storePagedSlice(source: string, slice: string): string {
    const token = createHash('sha256').update(`${source}\n${slice}`).digest('hex').slice(0, 16);
    if (!this.pageStore.has(token)) {
      const pages = this.chunkSlice(slice, this.pageSizeChars);
      this.pageStore.set(token, { source, pages, createdAt: new Date().toISOString() });

      while (this.pageStore.size > this.maxPageStoreEntries) {
        const oldest = this.pageStore.keys().next().value;
        if (!oldest) {
          break;
        }
        this.pageStore.delete(oldest);
      }
    }

    return token;
  }

  private chunkSlice(slice: string, maxChars: number): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < slice.length; i += maxChars) {
      chunks.push(slice.slice(i, i + maxChars));
    }

    return chunks.length > 0 ? chunks : [''];
  }

  private renderPagedSlice(token: string, pageNumber: number): string {
    const entry = this.pageStore.get(token);
    if (!entry) {
      return [
        '[OS_TRAP: PAGE_FAULT] Unknown page token.',
        `Token=${token}`,
        'Action: re-read original pointer to regenerate page table.',
      ].join('\n');
    }

    const total = entry.pages.length;
    const clamped = Math.min(Math.max(pageNumber, 1), total);
    const idx = clamped - 1;
    const prev = clamped > 1 ? `sys://page/${token}?p=${clamped - 1}` : '(none)';
    const next = clamped < total ? `sys://page/${token}?p=${clamped + 1}` : '(none)';

    return [
      '[PAGE_TABLE_SUMMARY]',
      `Token=${token}`,
      `Source=${entry.source}`,
      `TotalPages=${total}`,
      `FocusPage=${clamped}`,
      `PrevPage=${prev}`,
      `NextPage=${next}`,
      `CapturedAt=${entry.createdAt}`,
      '',
      '[FOCUS_PAGE_CONTENT]',
      entry.pages[idx] ?? '',
      '',
      'Action: use SYS_GOTO with PrevPage/NextPage pointer to flip pages.',
    ].join('\n');
  }

  private renderCallStackSnapshot(channel: string): string {
    const queue = this.normalizeRunQueue(this.readRunQueue());
    const topTask = this.resolveActiveTask(queue);
    const top = topTask ? topTask.objective : '(empty)';
    const frames =
      queue.length > 0
        ? [...queue]
            .reverse()
            .map(
              (item, idx) =>
                `${idx + 1}. [${item.status}] ${item.task_id} :: ${item.objective}${
                  item.scratchpad && item.scratchpad !== item.objective ? ` | scratchpad=${item.scratchpad}` : ''
                }`
            )
            .join('\n')
        : '(empty)';
    const active = queue.filter((task) => task.status === 'ACTIVE');
    const suspended = queue.filter((task) => task.status === 'SUSPENDED');
    const blocked = queue.filter((task) => task.status === 'BLOCKED');
    const renderBucket = (tasks: RunQueueTask[]): string =>
      tasks.length === 0 ? '(none)' : tasks.map((task) => `${task.task_id}:${task.objective}`).join(' | ');

    return [
      `[SYSTEM_CHANNEL] ${channel}`,
      `[CALL_STACK_DEPTH] ${queue.length}`,
      `[CALL_STACK_TOP] ${top}`,
      `[RUNQUEUE_ACTIVE] ${renderBucket(active)}`,
      `[RUNQUEUE_SUSPENDED] ${renderBucket(suspended)}`,
      `[RUNQUEUE_BLOCKED] ${renderBucket(blocked)}`,
      '[RUNQUEUE_JSON]',
      JSON.stringify(queue, null, 2),
      '[CALL_STACK]',
      frames,
      'Action: use SYS_PUSH(task) / SYS_EDIT(task) / SYS_MOVE(task_id,target_pos,status) / SYS_POP syscall opcodes for queue control.',
    ].join('\n');
  }

  private applyCallStackSyscall(payload: string): void {
    const instruction = payload.trim();
    const queue = this.normalizeRunQueue(this.readRunQueue());

    if (instruction.length === 0 || instruction.toUpperCase() === 'NOP') {
      return;
    }

    if (instruction.toUpperCase() === 'POP') {
      const activeIdx = this.resolveActiveTaskIndex(queue);
      if (activeIdx >= 0) {
        queue.splice(activeIdx, 1);
      } else if (queue.length > 0) {
        queue.pop();
      }
      this.writeRunQueue(this.normalizeRunQueue(queue));
      return;
    }

    if (instruction.toUpperCase() === 'RESET' || instruction.toUpperCase() === 'CLEAR') {
      this.writeRunQueue([]);
      return;
    }

    const pushMatch = instruction.match(/^PUSH\s*:?\s*(.+)$/is);
    if (pushMatch?.[1]) {
      const task = pushMatch[1].trim().replace(/\s+/g, ' ');
      if (task.length === 0) {
        throw new Error('PUSH payload is empty.');
      }

      const now = new Date().toISOString();
      for (const item of queue) {
        if (item.status === 'ACTIVE') {
          item.status = 'SUSPENDED';
          item.updated_at = now;
        }
      }
      queue.push({
        task_id: this.issueTaskId(task),
        status: 'ACTIVE',
        objective: task.slice(0, 200),
        scratchpad: task.slice(0, 200),
        created_at: now,
        updated_at: now,
      });
      if (queue.length > this.maxCallStackDepth) {
        queue.splice(0, queue.length - this.maxCallStackDepth);
      }
      this.writeRunQueue(this.normalizeRunQueue(queue));
      return;
    }

    const editMatch = instruction.match(/^EDIT\s*:?\s*(.+)$/is);
    if (editMatch?.[1]) {
      const task = editMatch[1].trim().replace(/\s+/g, ' ');
      if (task.length === 0) {
        throw new Error('EDIT payload is empty.');
      }
      const activeIdx = this.resolveActiveTaskIndex(queue);
      if (activeIdx < 0) {
        throw new Error('EDIT requires non-empty runqueue.');
      }

      const target = queue[activeIdx];
      target.objective = task.slice(0, 200);
      target.scratchpad = task.slice(0, 200);
      target.updated_at = new Date().toISOString();
      this.writeRunQueue(this.normalizeRunQueue(queue));
      return;
    }

    const moveMatch = instruction.match(/^MOVE\s*:?\s*(.*)$/is);
    if (moveMatch) {
      const move = this.parseMoveInstruction(moveMatch[1] ?? '');
      const normalizedTarget = move.targetPos ?? 'BOTTOM';
      const sourceIdx = this.resolveMoveSourceIndex(queue, move.taskId);
      if (sourceIdx < 0) {
        throw new Error('MOVE requires non-empty runqueue.');
      }

      const [task] = queue.splice(sourceIdx, 1);
      if (!task) {
        throw new Error('MOVE source task is empty.');
      }
      const now = new Date().toISOString();
      task.updated_at = now;

      if (move.status) {
        task.status = move.status;
      } else if (normalizedTarget === 'TOP') {
        task.status = 'ACTIVE';
      } else if (normalizedTarget === 'BOTTOM' && task.status === 'ACTIVE') {
        task.status = 'SUSPENDED';
      }

      if (normalizedTarget === 'TOP') {
        queue.push(task);
      } else {
        queue.unshift(task);
      }

      if (task.status === 'ACTIVE') {
        for (const item of queue) {
          if (item.task_id !== task.task_id && item.status === 'ACTIVE') {
            item.status = 'SUSPENDED';
            item.updated_at = now;
          }
        }
      }

      this.writeRunQueue(this.normalizeRunQueue(queue));
      return;
    }

    throw new Error(`Invalid callstack syscall payload: "${instruction}"`);
  }

  private observeGitLogChannel(base: string, params: URLSearchParams): string {
    const limitRaw = params.get('limit');
    const parsedLimit = limitRaw ? Number.parseInt(limitRaw, 10) : Number.NaN;
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 20;
    const ref = (params.get('ref') ?? 'HEAD').trim() || 'HEAD';
    const pathFilter = (params.get('path') ?? '').trim();
    const grep = (params.get('grep') ?? '').trim();
    const since = (params.get('since') ?? '').trim();
    const freeQuery = (params.get('query_params') ?? '').trim();

    const args: string[] = [
      'log',
      `-n${limit}`,
      '--date=iso',
      '--pretty=format:%H%x09%ad%x09%an%x09%s',
    ];
    if (since.length > 0) {
      args.push(`--since=${since}`);
    }
    if (grep.length > 0) {
      args.push(`--grep=${grep}`);
    }
    args.push(ref);
    if (pathFilter.length > 0) {
      args.push('--', pathFilter);
    }

    const executedCmd = ['git', ...args].join(' ');
    const result = spawnSync('git', args, {
      cwd: this.workspaceDir,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
    });

    if (result.error) {
      return [
        `[SYSTEM_CHANNEL] ${base}`,
        '[OS_TRAP: IO_FAULT]',
        `Failed to execute git log: ${result.error.message}`,
        `[EXEC] ${executedCmd}`,
      ].join('\n');
    }

    if (result.status !== 0) {
      const stderr = (result.stderr ?? '').toString().trim() || '(empty)';
      return [
        `[SYSTEM_CHANNEL] ${base}`,
        '[OS_TRAP: IO_FAULT]',
        `git log exited with code ${result.status}`,
        '[STDERR]',
        stderr,
        '[HINT]',
        'Ensure workspace is a git repository and requested ref/path exists.',
        `[EXEC] ${executedCmd}`,
      ].join('\n');
    }

    const stdout = (result.stdout ?? '').toString();
    const commits = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line, index) => {
        const [hash = '', date = '', author = '', ...subjectParts] = line.split('\t');
        const subject = subjectParts.join('\t').trim();
        const shortHash = hash.slice(0, 12);
        return `${index + 1}. ${shortHash} | ${date} | ${author} | ${subject}`;
      });

    return [
      `[SYSTEM_CHANNEL] ${base}`,
      '[GIT_LOG]',
      `Ref=${ref}`,
      `Limit=${limit}`,
      `Path=${pathFilter || '(all)'}`,
      `Grep=${grep || '(none)'}`,
      `Since=${since || '(none)'}`,
      `QueryParams=${freeQuery || '(none)'}`,
      `Rows=${commits.length}`,
      '[COMMITS]',
      commits.length > 0 ? commits.join('\n') : '(empty)',
      'Action: use SYS_GOTO(sys://page/<token>?p=2) if page summary appears.',
    ].join('\n');
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

  private loadCapabilities(): void {
    if (!fs.existsSync(this.capabilityFile)) {
      fs.writeFileSync(this.capabilityFile, `${JSON.stringify({ entries: [] }, null, 2)}\n`, 'utf-8');
      return;
    }

    try {
      const raw = fs.readFileSync(this.capabilityFile, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      const candidateEntries = Array.isArray(parsed)
        ? parsed
        : (parsed as { entries?: unknown })?.entries;
      if (!Array.isArray(candidateEntries)) {
        return;
      }

      for (const item of candidateEntries) {
        if (!item || typeof item !== 'object') {
          continue;
        }
        const maybe = item as Partial<SemanticCapabilityEntry>;
        const handle = typeof maybe.handle === 'string' ? maybe.handle.trim() : '';
        const targetPointer = typeof maybe.targetPointer === 'string' ? maybe.targetPointer.trim() : '';
        const access = maybe.access;
        const issuedAt = typeof maybe.issuedAt === 'string' ? maybe.issuedAt : new Date().toISOString();
        if (handle.length === 0 || targetPointer.length === 0) {
          continue;
        }
        if (access !== 'r' && access !== 'w' && access !== 'rw') {
          continue;
        }

        if (!this.capabilityStore.has(handle)) {
          this.capabilityStore.set(handle, {
            handle,
            targetPointer,
            access,
            issuedAt,
          });
          this.capabilityOrder.push(handle);
        }
      }
    } catch {
      // Ignore malformed capability file and continue with empty store.
    }
  }

  private persistCapabilities(): void {
    const entries = this.capabilityOrder
      .map((handle) => this.capabilityStore.get(handle))
      .filter((entry): entry is SemanticCapabilityEntry => !!entry);
    fs.writeFileSync(this.capabilityFile, `${JSON.stringify({ entries }, null, 2)}\n`, 'utf-8');
  }

  private parseCapabilityAccess(raw: string | null | undefined): CapabilityAccess | null {
    if (!raw) {
      return 'rw';
    }

    const normalized = raw.trim().toLowerCase();
    if (normalized === 'r' || normalized === 'read') {
      return 'r';
    }
    if (normalized === 'w' || normalized === 'write') {
      return 'w';
    }
    if (normalized === 'rw' || normalized === 'wr' || normalized === 'readwrite' || normalized === 'read-write') {
      return 'rw';
    }

    return null;
  }

  private issueCapabilityHandle(targetPointer: string, access: CapabilityAccess): SemanticCapabilityEntry {
    const normalizedTarget = targetPointer.trim();
    if (normalizedTarget.length === 0) {
      throw new Error('Capability target pointer is empty.');
    }
    if (normalizedTarget.startsWith('sys://cap/')) {
      throw new Error('Cannot issue capability to capability control channels.');
    }

    for (const handle of this.capabilityOrder) {
      const existing = this.capabilityStore.get(handle);
      if (!existing) {
        continue;
      }
      if (existing.targetPointer === normalizedTarget && existing.access === access) {
        return existing;
      }
    }

    const semanticTail = this.semanticTail(normalizedTarget);
    const hash = createHash('sha256')
      .update(`${access}\n${normalizedTarget}\n${Date.now()}\n${Math.random().toString(16).slice(2)}`)
      .digest('hex')
      .slice(0, 12);
    const handle = `vfd://${access}/${hash}/${semanticTail}`;
    const entry: SemanticCapabilityEntry = {
      handle,
      targetPointer: normalizedTarget,
      access,
      issuedAt: new Date().toISOString(),
    };

    this.capabilityStore.set(handle, entry);
    this.capabilityOrder.push(handle);
    while (this.capabilityOrder.length > this.maxCapabilities) {
      const oldest = this.capabilityOrder.shift();
      if (!oldest) {
        break;
      }
      this.capabilityStore.delete(oldest);
    }
    this.persistCapabilities();
    return entry;
  }

  private semanticTail(pointer: string): string {
    const normalized = pointer
      .replace(/^\.\//, '')
      .replace(/\\/g, '/')
      .replace(/[^a-zA-Z0-9._/-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^\/+/, '')
      .slice(0, 80);
    return normalized.length > 0 ? normalized : 'target';
  }

  private resolveCapabilityHandle(handlePointer: string, requiredAccess: 'r' | 'w'): string {
    const baseHandle = handlePointer.split('?', 1)[0].trim();
    const entry = this.capabilityStore.get(baseHandle);
    if (!entry) {
      throw new Error(`[OS_TRAP: EACCES] Unknown capability handle: ${baseHandle}`);
    }

    const allowRead = entry.access === 'r' || entry.access === 'rw';
    const allowWrite = entry.access === 'w' || entry.access === 'rw';
    if (requiredAccess === 'r' && !allowRead) {
      throw new Error(`[OS_TRAP: EACCES] Capability is not readable: ${baseHandle}`);
    }
    if (requiredAccess === 'w' && !allowWrite) {
      throw new Error(`[OS_TRAP: EACCES] Capability is not writable: ${baseHandle}`);
    }

    return entry.targetPointer;
  }

  private observeCapabilityChannel(pointer: string): string {
    const [base, query = ''] = pointer.split('?', 2);
    const params = new URLSearchParams(query);

    if (base === 'sys://cap/list') {
      if (this.capabilityOrder.length === 0) {
        return [
          '[SYSTEM_CHANNEL] sys://cap/list',
          '[CAPABILITY_TABLE]',
          '(empty)',
          'Action: issue handle via sys://cap/issue/<pointer>?access=rw',
        ].join('\n');
      }

      const lines = this.capabilityOrder
        .map((handle, index) => {
          const entry = this.capabilityStore.get(handle);
          if (!entry) {
            return null;
          }
          return `${index + 1}. ${entry.handle} -> ${entry.targetPointer} [${entry.access}]`;
        })
        .filter((line): line is string => !!line);
      return [
        '[SYSTEM_CHANNEL] sys://cap/list',
        '[CAPABILITY_TABLE]',
        ...lines,
      ].join('\n');
    }

    if (base.startsWith('sys://cap/describe/')) {
      const encoded = base.slice('sys://cap/describe/'.length).trim();
      const decoded = this.decodeURIComponentSafe(encoded);
      const handle = decoded.startsWith('vfd://') ? decoded : `vfd://${decoded.replace(/^vfd:\/\//, '')}`;
      const entry = this.capabilityStore.get(handle);
      if (!entry) {
        return [
          `[SYSTEM_CHANNEL] ${base}`,
          '[OS_TRAP: EACCES]',
          `Unknown capability: ${decoded}`,
        ].join('\n');
      }
      return [
        `[SYSTEM_CHANNEL] ${base}`,
        `[HANDLE] ${entry.handle}`,
        `[TARGET] ${entry.targetPointer}`,
        `[ACCESS] ${entry.access}`,
        `[ISSUED_AT] ${entry.issuedAt}`,
      ].join('\n');
    }

    if (base.startsWith('sys://cap/issue/')) {
      const encodedTarget = base.slice('sys://cap/issue/'.length).trim();
      const targetPointer = this.decodeURIComponentSafe(encodedTarget);
      if (targetPointer.length === 0) {
        return [
          `[SYSTEM_CHANNEL] ${base}`,
          '[OS_TRAP: INVALID_ARGUMENT]',
          'Target pointer is empty.',
          'Usage: sys://cap/issue/<pointer>?access=r|w|rw',
        ].join('\n');
      }

      const access = this.parseCapabilityAccess(params.get('access') ?? params.get('mode'));
      if (!access) {
        return [
          `[SYSTEM_CHANNEL] ${base}`,
          '[OS_TRAP: INVALID_ARGUMENT]',
          'Invalid access mode. Expected r|w|rw.',
        ].join('\n');
      }

      const entry = this.issueCapabilityHandle(targetPointer, access);
      return [
        `[SYSTEM_CHANNEL] ${base}`,
        '[CAPABILITY_ISSUED]',
        `[HANDLE] ${entry.handle}`,
        `[TARGET] ${entry.targetPointer}`,
        `[ACCESS] ${entry.access}`,
        '[NEXT]',
        'Use SYS_GOTO pointer=<HANDLE> to read, or SYS_WRITE semantic_cap=<HANDLE> to write if access allows.',
      ].join('\n');
    }

    return [
      `[SYSTEM_CHANNEL] ${base}`,
      '[CAP_HELP]',
      'Issue:    sys://cap/issue/<pointer>?access=r|w|rw',
      'List:     sys://cap/list',
      'Describe: sys://cap/describe/<url-encoded-vfd-handle>',
    ].join('\n');
  }

  private decodeURIComponentSafe(value: string): string {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  private readRunQueue(): RunQueueTask[] {
    try {
      const raw = fs.readFileSync(this.callStackFile, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }

      if (parsed.every((value) => typeof value === 'string')) {
        const legacy = parsed
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .filter((value) => value.length > 0)
          .slice(-this.maxCallStackDepth);
        const now = new Date().toISOString();
        return legacy.map((objective, idx) => ({
          task_id: this.legacyTaskId(objective, idx),
          status: idx === legacy.length - 1 ? 'ACTIVE' : 'SUSPENDED',
          objective: objective.slice(0, 200),
          scratchpad: objective.slice(0, 200),
          created_at: now,
          updated_at: now,
        }));
      }

      return parsed
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
        .map((item) => {
          const objectiveRaw =
            typeof item.objective === 'string'
              ? item.objective
              : typeof item.task === 'string'
                ? item.task
                : typeof item.scratchpad === 'string'
                  ? item.scratchpad
                  : '';
          const objective = objectiveRaw.trim().slice(0, 200);
          if (objective.length === 0) {
            return null;
          }

          const taskIdRaw =
            typeof item.task_id === 'string'
              ? item.task_id
              : typeof item.id === 'string'
                ? item.id
                : '';
          const taskId = taskIdRaw.trim().length > 0 ? taskIdRaw.trim() : this.issueTaskId(objective);

          const statusRaw = typeof item.status === 'string' ? item.status.trim().toUpperCase() : '';
          const status: RunqueueStatus =
            statusRaw === 'ACTIVE' || statusRaw === 'SUSPENDED' || statusRaw === 'BLOCKED'
              ? statusRaw
              : 'SUSPENDED';

          const scratchpadRaw = typeof item.scratchpad === 'string' ? item.scratchpad.trim() : objective;
          const scratchpad = scratchpadRaw.length > 0 ? scratchpadRaw.slice(0, 200) : objective;
          const createdAt = typeof item.created_at === 'string' ? item.created_at : new Date().toISOString();
          const updatedAt = typeof item.updated_at === 'string' ? item.updated_at : createdAt;

          return {
            task_id: taskId,
            status,
            objective,
            scratchpad,
            created_at: createdAt,
            updated_at: updatedAt,
          } satisfies RunQueueTask;
        })
        .filter((item): item is RunQueueTask => item !== null);
    } catch {
      return [];
    }
  }

  private normalizeRunQueue(queue: RunQueueTask[]): RunQueueTask[] {
    const normalized = queue
      .filter((task) => task && typeof task === 'object')
      .map((task) => {
        const objective = task.objective.trim().slice(0, 200);
        const scratchpad = (task.scratchpad || objective).trim().slice(0, 200);
        const statusRaw = task.status.trim().toUpperCase();
        const status: RunqueueStatus =
          statusRaw === 'ACTIVE' || statusRaw === 'SUSPENDED' || statusRaw === 'BLOCKED' ? statusRaw : 'SUSPENDED';
        const taskId = task.task_id.trim().length > 0 ? task.task_id.trim() : this.issueTaskId(objective);
        return {
          task_id: taskId,
          status,
          objective,
          scratchpad: scratchpad.length > 0 ? scratchpad : objective,
          created_at: task.created_at || new Date().toISOString(),
          updated_at: task.updated_at || task.created_at || new Date().toISOString(),
        };
      })
      .filter((task) => task.objective.length > 0)
      .slice(-this.maxCallStackDepth);

    const seen = new Set<string>();
    for (let i = 0; i < normalized.length; i += 1) {
      const candidate = normalized[i];
      if (!seen.has(candidate.task_id)) {
        seen.add(candidate.task_id);
        continue;
      }
      candidate.task_id = `${candidate.task_id}_${i}`;
      seen.add(candidate.task_id);
    }

    const activeIndices = normalized
      .map((task, idx) => (task.status === 'ACTIVE' ? idx : -1))
      .filter((idx) => idx >= 0);
    if (activeIndices.length > 1) {
      const keep = activeIndices[activeIndices.length - 1];
      for (const idx of activeIndices) {
        if (idx !== keep) {
          normalized[idx].status = 'SUSPENDED';
        }
      }
    } else if (activeIndices.length === 0 && normalized.length > 0) {
      const candidate = [...normalized].reverse().find((task) => task.status !== 'BLOCKED');
      if (candidate) {
        candidate.status = 'ACTIVE';
      }
    }

    return normalized;
  }

  private resolveActiveTaskIndex(queue: RunQueueTask[]): number {
    for (let i = queue.length - 1; i >= 0; i -= 1) {
      if (queue[i].status === 'ACTIVE') {
        return i;
      }
    }
    return -1;
  }

  private resolveActiveTask(queue: RunQueueTask[]): RunQueueTask | null {
    const idx = this.resolveActiveTaskIndex(queue);
    return idx >= 0 ? queue[idx] : null;
  }

  private parseMoveInstruction(raw: string): { taskId?: string; targetPos: RunqueueTargetPos; status?: RunqueueStatus } {
    const parts = raw
      .split(/[;,]/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    let taskId: string | undefined;
    let targetPos: RunqueueTargetPos = 'BOTTOM';
    let status: RunqueueStatus | undefined;

    for (const part of parts) {
      const keyValue = part.match(/^([a-z_]+)\s*=\s*(.+)$/i);
      if (keyValue?.[1] && keyValue[2]) {
        const key = keyValue[1].trim().toLowerCase();
        const value = keyValue[2].trim();
        if ((key === 'task_id' || key === 'task' || key === 'id') && value.length > 0) {
          taskId = value;
          continue;
        }
        if ((key === 'target_pos' || key === 'target' || key === 'position') && value.length > 0) {
          const normalized = value.toUpperCase();
          if (normalized !== 'TOP' && normalized !== 'BOTTOM') {
            throw new Error(`MOVE target_pos invalid: ${value}`);
          }
          targetPos = normalized;
          continue;
        }
        if ((key === 'status' || key === 'state') && value.length > 0) {
          const normalized = value.toUpperCase();
          if (normalized !== 'ACTIVE' && normalized !== 'SUSPENDED' && normalized !== 'BLOCKED') {
            throw new Error(`MOVE status invalid: ${value}`);
          }
          status = normalized;
        }
        continue;
      }

      const maybeTarget = part.toUpperCase();
      if (maybeTarget === 'TOP' || maybeTarget === 'BOTTOM') {
        targetPos = maybeTarget;
      } else if (part.length > 0) {
        taskId = part;
      }
    }

    return { taskId, targetPos, status };
  }

  private resolveMoveSourceIndex(queue: RunQueueTask[], taskId?: string): number {
    if (taskId && taskId.trim().length > 0) {
      return queue.findIndex((task) => task.task_id === taskId.trim());
    }
    return this.resolveActiveTaskIndex(queue);
  }

  private issueTaskId(task: string): string {
    const digest = createHash('sha256')
      .update(`${new Date().toISOString()}|${task}|${Math.random()}`)
      .digest('hex')
      .slice(0, 12);
    return `task_${digest}`;
  }

  private legacyTaskId(task: string, index: number): string {
    const digest = createHash('sha256').update(`legacy|${index}|${task}`).digest('hex').slice(0, 10);
    return `legacy_${digest}`;
  }

  private writeRunQueue(queue: RunQueueTask[]): void {
    fs.writeFileSync(this.callStackFile, `${JSON.stringify(queue, null, 2)}\n`, 'utf-8');
  }
}
