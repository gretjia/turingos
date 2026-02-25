# Context for Gemini Design

## Scope
# Cycle Scope

## Objective
Execute the first Codex x Gemini closed-loop cycle to improve long-run stability and plan adherence for TuringOS.

## Why this cycle
- Repository has uncommitted oracle refactor changes (`universal-oracle.ts`, `boot.ts`, deletion of `kimi-code-oracle.ts`).
- Need evidence-driven decision on whether to keep and how to proceed.
- Need to apply workflow with reproducible artifacts.

## In-Scope
1. Establish baseline with current code (`typecheck`, `smoke:mock`, `bench:os-longrun`).
2. Ask Gemini 3.1 Pro Preview for first-principles design recommendations based on baseline evidence.
3. Implement minimal high-impact fixes aligned with:
   - call stack syscall
   - MMU guard
   - L1 trace cache
   - thought -> json protocol
4. Re-run same benchmark set and compare metrics.
5. Produce Go/No-Go decision with evidence paths.

## Out-of-Scope
- Full architecture rewrite of all kernel modules in one cycle.
- Changing benchmark definitions themselves.

## Acceptance Gate
- Evidence artifacts complete.
- At least one core metric improves or critical failure mode is reduced.
- No typecheck regression.

## Baseline Results Summary
# Test Results (Baseline)

- Source JSON:     benchmarks/results/os-longrun-20260225-095940.json
- Source Markdown: benchmarks/results/os-longrun-20260225-095940.md
- Raw command log: benchmarks/audits/cycles/20260225_0959_cycle_01/04_test_commands.txt

## Key Metrics

- Runs: 3
- Passed: 0/3
- completion_avg: 0
- plan_avg: 0.3333
- pointer_drift_avg: 0
- watchdog_avg: 0.3333

## Snapshot

```json
{
  "runStamp": "20260225-095940",
  "model": "kimi-for-coding",
  "repeats": 1,
  "runs": 3,
  "passed": 0,
  "completion_avg": 0,
  "plan_avg": 0.3333,
  "drift_avg": 0,
  "traps_avg": {
    "WATCHDOG_NMI": 0.3333,
    "CPU_FAULT": 0,
    "IO_FAULT": 0,
    "PAGE_FAULT": 17.3333
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
      "planAvg": 1,
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
      "completionAvg": 0,
      "completionP50": 0,
      "completionP90": 0,
      "planAvg": 0,
      "driftAvg": 0,
      "haltedRate": 0,
      "maxTickRate": 1,
      "watchdogAvg": 1
    },
    {
      "id": "pipeline_ordered_execution",
      "name": "Pipeline Ordered Execution",
      "runs": 1,
      "passRate": 0,
      "completionAvg": 0,
      "completionP50": 0,
      "completionP90": 0,
      "planAvg": 0,
      "driftAvg": 0,
      "haltedRate": 0,
      "maxTickRate": 1,
      "watchdogAvg": 0
    }
  ]
}
```

## Current Kernel/Runtime Code (selected)

### src/kernel/types.ts
```ts
export type State = string;
export type Pointer = string;
export type Slice = string;

export interface Transition {
  q_next: State;
  s_prime: string;
  d_next: Pointer;
}

export interface IOracle {
  collapse(discipline: string, q: State, s: Slice): Promise<Transition>;
}

export interface IPhysicalManifold {
  observe(pointer: Pointer): Promise<Slice>;
  interfere(pointer: Pointer, payload: string): Promise<void>;
}

export interface IChronos {
  engrave(entry: string): Promise<void>;
}

export interface ContractCheckResult {
  ok: boolean;
  reason?: string;
}

export interface IExecutionContract {
  checkProgress(): Promise<ContractCheckResult>;
  checkHalt(): Promise<ContractCheckResult>;
}
```

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

    // 3) Watchdog non-maskable interrupt against repeated actions.
    const actionHash = createHash('sha256')
      .update(`${d_next}|${s_prime.slice(0, 80)}`)
      .digest('hex');

    this.watchdogHistory.push(actionHash);
    if (this.watchdogHistory.length > 5) {
      this.watchdogHistory.shift();
    }

    const isStuck =
      this.watchdogHistory.length === 5 &&
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
    await this.chronos.engrave(`[Tick] d:${d_t} -> d':${d_next} | ${shortQ}`);

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
```

### src/runtime/registers.ts
```ts
import fs from 'node:fs';
import path from 'node:path';
import { Pointer, State } from '../kernel/types.js';

export class FileRegisters {
  private qFile: string;
  private dFile: string;

  constructor(private workspaceDir: string) {
    this.qFile = path.join(workspaceDir, '.reg_q');
    this.dFile = path.join(workspaceDir, '.reg_d');
    fs.mkdirSync(workspaceDir, { recursive: true });
  }

  public bootstrap(initialQ: State, initialD: Pointer): void {
    if (!fs.existsSync(this.qFile)) {
      fs.writeFileSync(this.qFile, `${initialQ.trim()}\n`, 'utf-8');
    }

    if (!fs.existsSync(this.dFile)) {
      fs.writeFileSync(this.dFile, `${initialD.trim()}\n`, 'utf-8');
    }
  }

  public readQ(): State {
    return fs.readFileSync(this.qFile, 'utf-8').trim();
  }

  public readD(): Pointer {
    return fs.readFileSync(this.dFile, 'utf-8').trim();
  }

  public write(q: State, d: Pointer): void {
    fs.writeFileSync(this.qFile, `${q.trim()}\n`, 'utf-8');
    fs.writeFileSync(this.dFile, `${d.trim()}\n`, 'utf-8');
  }
}
```

### src/oracle/universal-oracle.ts
```ts
import OpenAI from 'openai';
import { IOracle, Slice, State, Transition } from '../kernel/types.js';

type OracleMode = 'openai' | 'kimi';

interface KimiMessageBlock {
  type?: string;
  text?: string;
}

interface KimiMessageResponse {
  content?: KimiMessageBlock[];
}

interface UniversalOracleConfig {
  apiKey: string;
  model: string;
  baseURL?: string;
  maxOutputTokens?: number;
}

export class UniversalOracle implements IOracle {
  private openai?: OpenAI;
  private model: string;
  private kimimart?: {
    endpoint: string;
    apiKey: string;
    model: string;
    maxOutputTokens: number;
  };

  constructor(private mode: OracleMode, config: UniversalOracleConfig) {
    this.model = config.model;
    if (mode === 'openai') {
      const clientConfig: { apiKey: string; baseURL?: string } = { apiKey: config.apiKey };
      if (config.baseURL) {
        clientConfig.baseURL = config.baseURL;
      }
      this.openai = new OpenAI(clientConfig);
    } else if (mode === 'kimi') {
      const baseURL = config.baseURL ?? 'https://api.kimi.com/coding';
      const normalized = baseURL.replace(/\/+$/, '');
      const endpoint = normalized.endsWith('/v1') ? `${normalized}/messages` : `${normalized}/v1/messages`;

      this.kimimart = {
        endpoint,
        apiKey: config.apiKey,
        model: config.model,
        maxOutputTokens: config.maxOutputTokens ?? 1024,
      };
    }
  }

  public async collapse(discipline: string, q: State, s: Slice): Promise<Transition> {
    const prompt = [
      discipline,
      '',
      '================',
      '[CPU REGISTER q]:',
      q,
      '',
      '================',
      '[DATA BUS s]:',
      s,
    ].join('\n');

    const rawOutput = await this.request(prompt);
    return this.parseTransition(rawOutput);
  }

  private async request(prompt: string): Promise<string> {
    if (this.mode === 'openai' && this.openai) {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        response_format: { type: 'json_object' },
      });
      return response.choices[0]?.message?.content ?? '{}';
    }

    if (this.mode === 'kimi' && this.kimimart) {
      const response = await fetch(this.kimimart.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': this.kimimart.apiKey,
        },
        body: JSON.stringify({
          model: this.kimimart.model,
          max_tokens: this.kimimart.maxOutputTokens,
          temperature: 0,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      const raw = await response.text();
      if (!response.ok) {
        throw new Error(`Kimi API ${response.status}: ${raw.slice(0, 500)}`);
      }

      let parsed: KimiMessageResponse;
      try {
        parsed = JSON.parse(raw) as KimiMessageResponse;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid Kimi response JSON: ${message}. Raw: ${raw.slice(0, 500)}`);
      }

      const text = (parsed.content ?? [])
        .filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text?.trim() ?? '')
        .filter((line) => line.length > 0)
        .join('\n');

      if (text.length === 0) {
        throw new Error(`Empty model output. Raw: ${raw.slice(0, 500)}`);
      }

      return text;
    }

    throw new Error('Oracle not configured');
  }

  private parseTransition(rawOutput: string): Transition {
    const candidates: string[] = [rawOutput];

    // Some models wrap JSON in markdown fences, so we try fenced body too.
    const fencedMatch = rawOutput.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch?.[1]) {
      candidates.push(fencedMatch[1].trim());
    }

    const firstBrace = rawOutput.indexOf('{');
    const lastBrace = rawOutput.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      candidates.push(rawOutput.slice(firstBrace, lastBrace + 1));
    }

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        if (this.isTransition(parsed)) {
          return parsed;
        }
      } catch {
        // Try next candidate shape.
      }
    }

    throw new Error(`Invalid ALU output shape. Raw: ${rawOutput}`);
  }

  private isTransition(value: unknown): value is Transition {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const asRecord = value as Record<string, unknown>;
    return (
      typeof asRecord.q_next === 'string' &&
      typeof asRecord.s_prime === 'string' &&
      typeof asRecord.d_next === 'string'
    );
  }
}
```
