# Cycle 02 Design Context

## Scope
# Cycle 02 Scope

## Objective
Increase plan adherence and scenario completion without regressing stability gains from Cycle 01.

## Baseline for this cycle
- Use Cycle 01 post-change metrics as baseline:
  - passed=0/3
  - completion_avg=0.0333
  - plan_avg=0.2937
  - watchdog_avg=0
  - page_fault_avg=3.6667
- Source: `benchmarks/audits/cycles/20260225_0959_cycle_01/05_test_results_after.md`

## In-Scope
1. Inject explicit contract guidance (`NEXT_REQUIRED_DONE`) into each tick context.
2. Guard `sys://append/plan/progress.log` writes with order validation/normalization.
3. Keep Cycle 01 gains (`WATCHDOG_NMI=0`, low `PAGE_FAULT`).
4. Re-run same `bench:os-longrun` and compare metrics.

## Out-of-Scope
- Rewriting benchmark tasks.
- Large architecture rewrites outside engine/manifold/prompt/contract interfaces.

## Acceptance Gate
- No regression in watchdog/page-fault stability.
- Improvement in at least one of:
  - `plan_avg`
  - `completion_avg`
  - scenario pass count

## Baseline
# Test Results (Post-change)

- Source JSON: benchmarks/results/os-longrun-20260225-101154.json
- Source Markdown: benchmarks/results/os-longrun-20260225-101154.md
- Raw command log: benchmarks/audits/cycles/20260225_0959_cycle_01/04_test_commands_after.txt

## Key Metrics

```json
{
  "runStamp": "20260225-101154",
  "model": "kimi-for-coding",
  "repeats": 1,
  "runs": 3,
  "passed": 0,
  "completion_avg": 0.0333,
  "plan_avg": 0.2937,
  "drift_avg": 0,
  "traps_avg": {
    "WATCHDOG_NMI": 0,
    "CPU_FAULT": 0,
    "IO_FAULT": 0,
    "PAGE_FAULT": 3.6667
  },
  "per_scenario": [
    {
      "id": "fault_recovery_resume",
      "name": "Fault Recovery Resume",
      "runs": 1,
      "passRate": 0,
      "completionAvg": 0,
      "completionP50": 0,
      "completionP90": 0,
      "planAvg": 0.1429,
      "driftAvg": 0,
      "haltedRate": 0,
      "maxTickRate": 1,
      "watchdogAvg": 0
    },
    {
      "id": "long_checklist_stability",
      "name": "Long Checklist Stability",
      "runs": 1,
      "passRate": 0,
      "completionAvg": 0.1,
      "completionP50": 0.1,
      "completionP90": 0.1,
      "planAvg": 0.1667,
      "driftAvg": 0,
      "haltedRate": 0,
      "maxTickRate": 1,
      "watchdogAvg": 0
    },
    {
      "id": "pipeline_ordered_execution",
      "name": "Pipeline Ordered Execution",
      "runs": 1,
      "passRate": 0,
      "completionAvg": 0,
      "completionP50": 0,
      "completionP90": 0,
      "planAvg": 0.5714,
      "driftAvg": 0,
      "haltedRate": 0,
      "maxTickRate": 1,
      "watchdogAvg": 0
    }
  ]
}
```

## Baseline vs Post

```json
{
  "passed_before": 0,
  "passed_after": 0,
  "completion_before": 0,
  "completion_after": 0.0333,
  "completion_delta": 0.0333,
  "plan_before": 0.3333,
  "plan_after": 0.2937,
  "plan_delta": -0.0396,
  "drift_before": 0,
  "drift_after": 0,
  "drift_delta": 0,
  "watchdog_before": 0.3333,
  "watchdog_after": 0,
  "watchdog_delta": -0.3333,
  "page_fault_before": 17.3333,
  "page_fault_after": 3.6667,
  "page_fault_delta": -13.6666
}
```

## Current code focus
### src/kernel/engine.ts
```ts
import { createHash } from 'node:crypto';
import {
  IChronos,
  IExecutionContract,
  IOracle,
  IPhysicalManifold,
  Pointer,
  Slice,
  State,
  Transition,
} from './types.js';

export interface IgniteOptions {
  maxTicks?: number;
  onTick?: (tick: number, q: State, d: Pointer) => Promise<void> | void;
}

export interface IgniteResult {
  ticks: number;
  q: State;
  d: Pointer;
}

export class TuringEngine {
  private watchdogHistory: string[] = [];
  private l1TraceCache: string[] = [];
  private readonly l1TraceDepth = 3;
  private readonly watchdogDepth = 5;
  private lastObservedPointer?: Pointer;
  private lastObservedSlice?: Slice;
  private lastTrapDetails = new Map<string, string>();

  constructor(
    private manifold: IPhysicalManifold,
    private oracle: IOracle,
    private chronos: IChronos,
    private disciplinePrompt: string,
    private executionContract?: IExecutionContract
  ) {}

  public async tick(q_t: State, d_t: Pointer): Promise<[State, Pointer]> {
    let s_t: Slice;
    const pointer = d_t.trim();

    // 1) Observe from the physical manifold.
    try {
      s_t = await this.manifold.observe(d_t);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const missingFile = !pointer.startsWith('$') && !pointer.startsWith('sys://') && message.includes('File not found');
      s_t = missingFile
        ? [
            `[OS_TRAP: PAGE_FAULT] Target ${d_t} does not exist yet.`,
            `Details: ${message}`,
            'Action: If you are creating this file, continue and write exact content at current pointer.',
          ].join('\n')
        : [
            `[OS_TRAP: PAGE_FAULT] Failed to observe coordinate ${d_t}.`,
            `Details: ${message}`,
            'Action: Create the resource or fix the pointer path in your next cycle.',
          ].join('\n');
    }

    // 1.5) Validate progress contract and feed violations back as trap context.
    if (this.executionContract) {
      try {
        const progressCheck = await this.executionContract.checkProgress();
        if (!progressCheck.ok) {
          const reason = progressCheck.reason ?? 'Unknown contract error.';
          const action = reason.includes('required file is missing')
            ? 'Action: Create the missing file for that DONE step first, then continue to next step.'
            : reason.includes('Out-of-order progress') || reason.includes('Progress exceeds')
              ? 'Action: Repair progress log to strict ordered DONE:<STEP_ID> prefix.'
              : 'Action: Continue in strict plan order and append one DONE line per completed step.';
          s_t = [
            s_t,
            '',
            '[OS_TRAP: PLAN_CONTRACT] Progress log violates execution contract.',
            `Details: ${reason}`,
            action,
          ].join('\n');
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        s_t = [
          s_t,
          '',
          '[OS_TRAP: PLAN_CONTRACT] Contract checker crashed.',
          `Details: ${message}`,
          'Action: Recover by continuing with strict plan order and DONE markers.',
        ].join('\n');
      }
    }

    // 1.6) Inject memorized trap details for bare trap channels.
    if (pointer.startsWith('sys://trap/') && !pointer.includes('?details=')) {
      const cached = this.lastTrapDetails.get(pointer);
      if (cached) {
        s_t = [s_t, '', '[DETAILS]', cached].join('\n');
      }
    }

    // 1.7) Soft trap for repeated successful command with unchanged observed slice.
    const repeatedSuccessfulCommand =
      pointer.startsWith('$') &&
      this.lastObservedPointer === pointer &&
      this.lastObservedSlice === s_t &&
      s_t.includes('[EXIT_CODE] 0');
    if (repeatedSuccessfulCommand) {
      s_t = [
        s_t,
        '',
        '[OS_TRAP: NO_PROGRESS] Same successful command repeated without state change.',
        'Action: Mark current step once, then move to next planned step and pointer.',
      ].join('\n');
    }

    this.lastObservedPointer = pointer;
    this.lastObservedSlice = s_t;

    // 1.8) Inject managed context channels for short-horizon anti-looping.
    const callStackSlice = await this.observeCallStackSnapshot();
    const l1TraceSlice = this.renderL1Trace();
    s_t = [
      '[L1_TRACE_CACHE]',
      l1TraceSlice,
      '',
      '[OS_CALL_STACK]',
      callStackSlice,
      '',
      '[OBSERVED_SLICE]',
      s_t,
    ].join('\n');

    // 2) Run the oracle transition.
    let transition: Transition;
    try {
      transition = await this.oracle.collapse(this.disciplinePrompt, q_t, s_t);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return [
        [
          `[OS_TRAP: CPU_FAULT] Previous output caused kernel panic: ${message}`,
          'You MUST output strictly valid JSON. Keep Todo stack intact and try again.',
          '',
          '[RECOVERED STATE q]:',
          q_t,
        ].join('\n'),
        'sys://trap/cpu_fault',
      ];
    }

    const { q_next, s_prime, d_next } = transition;

    // 2.2) Apply syscall-driven call stack operations (OS-managed memory).
    try {
      await this.applyStackSyscall(transition);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return [
        [
          q_t,
          '',
          `[OS_TRAP: STACK_FAULT] Failed to apply stack syscall: ${message}`,
          'Action: emit valid stack_op and stack_payload (for PUSH) in next JSON transition.',
        ].join('\n'),
        'sys://trap/stack_fault',
      ];
    }

    // 2.5) HALT guard: block HALT unless acceptance contract is satisfied.
    const haltRequested = q_next.trim() === 'HALT' || d_next.trim() === 'HALT';
    if (haltRequested && this.executionContract) {
      try {
        const haltCheck = await this.executionContract.checkHalt();
        if (!haltCheck.ok) {
          const trapDetails = [
            'HALT rejected: acceptance contract not satisfied.',
            `Details: ${haltCheck.reason ?? 'Unknown contract error.'}`,
            'Action: Complete remaining plan steps and required files, then HALT.',
          ].join('\n');
          this.lastTrapDetails.set('sys://trap/halt_guard', trapDetails);
          return [
            q_t,
            this.systemTrapPointer('sys://trap/halt_guard', trapDetails),
          ];
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const trapDetails = [
          'Contract checker crashed while validating HALT.',
          `Details: ${message}`,
          'Action: Retry HALT only after contract checker recovers.',
        ].join('\n');
        this.lastTrapDetails.set('sys://trap/halt_guard', trapDetails);
        return [
          q_t,
          this.systemTrapPointer('sys://trap/halt_guard', trapDetails),
        ];
      }
    }

    // 3) L1 trace pre-watchdog interrupt for short action loops.
    const actionHash = this.actionSignature(d_next, s_prime);
    this.l1TraceCache.push(actionHash);
    if (this.l1TraceCache.length > this.l1TraceDepth) {
      this.l1TraceCache.shift();
    }

    const l1LoopDetected =
      this.l1TraceCache.length === this.l1TraceDepth &&
      this.l1TraceCache.every((item) => item === actionHash);
    if (l1LoopDetected) {
      this.l1TraceCache = [];
      return [
        [
          '[OS_TRAP: L1_CACHE_HIT] Repeated action detected in short horizon.',
          `Action signature: ${actionHash.slice(0, 12)}`,
          'Action: change strategy now (different pointer/command) or PUSH a diagnostic subtask.',
          '',
          '[RECOVERED STATE q]:',
          q_next,
        ].join('\n'),
        'sys://trap/l1_cache_hit',
      ];
    }

    // 3.5) Watchdog non-maskable interrupt against repeated actions.

    this.watchdogHistory.push(actionHash);
    if (this.watchdogHistory.length > this.watchdogDepth) {
      this.watchdogHistory.shift();
    }

    const isStuck =
      this.watchdogHistory.length === this.watchdogDepth &&
      this.watchdogHistory.every((h) => h === actionHash);

    if (isStuck) {
      this.watchdogHistory = [];
      return [
        [
          '[OS_TRAP: WATCHDOG_NMI] INFINITE LOOP DETECTED!',
          'You repeated the same action 5 times with no progress.',
          'Pop current task, log why it failed, and attempt a different strategy.',
          '',
          '[RECOVERED STATE q]:',
          q_next,
        ].join('\n'),
        'sys://trap/watchdog',
      ];
    }

    // 4) Interfere with physical world unless this is a pure read/exec step.
    const isAppendChannel = pointer.startsWith('sys://append/');
    if (s_prime.trim() !== '👆🏻' && (!pointer.startsWith('sys://') || isAppendChannel)) {
      try {
        await this.manifold.interfere(d_t, s_prime);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return [
          [
            q_next,
            '',
            `[OS_TRAP: IO_FAULT] Failed to write to ${d_t}: ${message}`,
            'Push a task to fix permission or syntax issue and retry.',
          ].join('\n'),
          'sys://trap/io_fault',
        ];
      }
    }

    const shortQ = q_next.split('\n').find((line) => line.trim().length > 0)?.slice(0, 60) ?? 'State updated';
    const shortThought =
      typeof transition.thought === 'string'
        ? transition.thought.split('\n').find((line) => line.trim().length > 0)?.slice(0, 80) ?? ''
        : '';
    const stackOp = transition.stack_op ?? 'NOP';
    const stackNote =
      stackOp === 'PUSH'
        ? `${stackOp}(${(transition.stack_payload ?? '').slice(0, 40)})`
        : stackOp;
    await this.chronos.engrave(
      `[Tick] d:${d_t} -> d':${d_next} | ${shortQ} | stack:${stackNote} | thought:${shortThought || '-'}`
    );

    return [q_next, d_next];
  }

  public async ignite(initialQ: State, initialD: Pointer, options: IgniteOptions = {}): Promise<IgniteResult> {
    const maxTicks = options.maxTicks ?? Number.POSITIVE_INFINITY;
    let ticks = 0;
    let q = initialQ;
    let d = initialD;

    while (q.trim() !== 'HALT' && d.trim() !== 'HALT') {
      if (ticks >= maxTicks) {
        await this.chronos.engrave(`[HALT_GUARD] Max ticks reached: ${maxTicks}`);
        break;
      }

      [q, d] = await this.tick(q, d);
      ticks += 1;

      if (options.onTick) {
        await options.onTick(ticks, q, d);
      }
    }

    return { ticks, q, d };
  }

  private systemTrapPointer(base: string, details: string): Pointer {
    return `${base}?details=${encodeURIComponent(details)}`;
  }

  private actionSignature(dNext: Pointer, sPrime: string): string {
    return createHash('sha256')
      .update(`${dNext}|${sPrime.slice(0, 120)}`)
      .digest('hex');
  }

  private renderL1Trace(): string {
    if (this.l1TraceCache.length === 0) {
      return '(empty)';
    }

    return this.l1TraceCache
      .map((hash, idx) => `${idx + 1}. ${hash.slice(0, 12)}`)
      .join('\n');
  }

  private async observeCallStackSnapshot(): Promise<string> {
    try {
      return await this.manifold.observe('sys://callstack');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return `[SYSTEM_CHANNEL] sys://callstack\n[DETAILS]\nUnavailable: ${message}`;
    }
  }
```

### src/manifold/local-manifold.ts
```ts
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
```

### src/runtime/file-execution-contract.ts
```ts
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
```
