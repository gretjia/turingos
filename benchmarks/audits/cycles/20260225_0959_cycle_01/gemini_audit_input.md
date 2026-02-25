# Independent Audit Context

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

## Baseline Results
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

## Post-change Results
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

## Metrics Delta
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

## Code Diff
```diff
diff --git a/benchmarks/os-longrun/discipline_prompt.txt b/benchmarks/os-longrun/discipline_prompt.txt
index ad996c1..43078d6 100644
--- a/benchmarks/os-longrun/discipline_prompt.txt
+++ b/benchmarks/os-longrun/discipline_prompt.txt
@@ -5,9 +5,12 @@ You are stateless except for `q_next`. Read MAIN_TAPE carefully and execute it l
 
 Return exactly one JSON object:
 {
+  "thought": "string (optional but recommended)",
   "q_next": "string",
   "s_prime": "string",
-  "d_next": "string"
+  "d_next": "string",
+  "stack_op": "PUSH|POP|NOP",
+  "stack_payload": "string (required only for PUSH)"
 }
 
 Hard protocol:
@@ -22,6 +25,7 @@ Hard protocol:
 4. For shell commands, always use `$ ` prefix.
 5. If MAIN_TAPE says `exactly`, produce exact content, exact keys, exact numeric values.
 6. Do not invent alternative schemas, file names, or column names.
+7. `stack_op` must be explicit each tick. Use `PUSH` before branching to error-recovery subtasks and `POP` after recovery.
 
 Plan execution contract:
 1. Keep `q_next` as compact ordered checklist with explicit STEP_IDs.
@@ -38,6 +42,7 @@ Trap handling:
 3. If you receive `sys://trap/halt_guard`, inspect `[DETAILS]`, create missing outputs, then continue plan.
 4. Do not repeat identical action more than 2 times; choose a different operation.
 5. If append channel reports duplicate append blocked, advance to the next unfinished step instead of retrying same DONE line.
+6. If you detect short-loop signals (`[OS_TRAP: L1_CACHE_HIT]`), immediately change strategy and consider `stack_op=PUSH`.
 
 HALT law:
 1. HALT only after all required artifacts are physically present and validated.
diff --git a/src/kernel/engine.ts b/src/kernel/engine.ts
index cc62561..4856ce9 100644
--- a/src/kernel/engine.ts
+++ b/src/kernel/engine.ts
@@ -23,6 +23,9 @@ export interface IgniteResult {
 
 export class TuringEngine {
   private watchdogHistory: string[] = [];
+  private l1TraceCache: string[] = [];
+  private readonly l1TraceDepth = 3;
+  private readonly watchdogDepth = 5;
   private lastObservedPointer?: Pointer;
   private lastObservedSlice?: Slice;
   private lastTrapDetails = new Map<string, string>();
@@ -115,6 +118,20 @@ export class TuringEngine {
     this.lastObservedPointer = pointer;
     this.lastObservedSlice = s_t;
 
+    // 1.8) Inject managed context channels for short-horizon anti-looping.
+    const callStackSlice = await this.observeCallStackSnapshot();
+    const l1TraceSlice = this.renderL1Trace();
+    s_t = [
+      '[L1_TRACE_CACHE]',
+      l1TraceSlice,
+      '',
+      '[OS_CALL_STACK]',
+      callStackSlice,
+      '',
+      '[OBSERVED_SLICE]',
+      s_t,
+    ].join('\n');
+
     // 2) Run the oracle transition.
     let transition: Transition;
     try {
@@ -135,6 +152,22 @@ export class TuringEngine {
 
     const { q_next, s_prime, d_next } = transition;
 
+    // 2.2) Apply syscall-driven call stack operations (OS-managed memory).
+    try {
+      await this.applyStackSyscall(transition);
+    } catch (error: unknown) {
+      const message = error instanceof Error ? error.message : String(error);
+      return [
+        [
+          q_t,
+          '',
+          `[OS_TRAP: STACK_FAULT] Failed to apply stack syscall: ${message}`,
+          'Action: emit valid stack_op and stack_payload (for PUSH) in next JSON transition.',
+        ].join('\n'),
+        'sys://trap/stack_fault',
+      ];
+    }
+
     // 2.5) HALT guard: block HALT unless acceptance contract is satisfied.
     const haltRequested = q_next.trim() === 'HALT' || d_next.trim() === 'HALT';
     if (haltRequested && this.executionContract) {
@@ -167,18 +200,40 @@ export class TuringEngine {
       }
     }
 
-    // 3) Watchdog non-maskable interrupt against repeated actions.
-    const actionHash = createHash('sha256')
-      .update(`${d_next}|${s_prime.slice(0, 80)}`)
-      .digest('hex');
+    // 3) L1 trace pre-watchdog interrupt for short action loops.
+    const actionHash = this.actionSignature(d_next, s_prime);
+    this.l1TraceCache.push(actionHash);
+    if (this.l1TraceCache.length > this.l1TraceDepth) {
+      this.l1TraceCache.shift();
+    }
+
+    const l1LoopDetected =
+      this.l1TraceCache.length === this.l1TraceDepth &&
+      this.l1TraceCache.every((item) => item === actionHash);
+    if (l1LoopDetected) {
+      this.l1TraceCache = [];
+      return [
+        [
+          '[OS_TRAP: L1_CACHE_HIT] Repeated action detected in short horizon.',
+          `Action signature: ${actionHash.slice(0, 12)}`,
+          'Action: change strategy now (different pointer/command) or PUSH a diagnostic subtask.',
+          '',
+          '[RECOVERED STATE q]:',
+          q_next,
+        ].join('\n'),
+        'sys://trap/l1_cache_hit',
+      ];
+    }
+
+    // 3.5) Watchdog non-maskable interrupt against repeated actions.
 
     this.watchdogHistory.push(actionHash);
-    if (this.watchdogHistory.length > 5) {
+    if (this.watchdogHistory.length > this.watchdogDepth) {
       this.watchdogHistory.shift();
     }
 
     const isStuck =
-      this.watchdogHistory.length === 5 &&
+      this.watchdogHistory.length === this.watchdogDepth &&
       this.watchdogHistory.every((h) => h === actionHash);
 
     if (isStuck) {
@@ -216,7 +271,18 @@ export class TuringEngine {
     }
 
     const shortQ = q_next.split('\n').find((line) => line.trim().length > 0)?.slice(0, 60) ?? 'State updated';
-    await this.chronos.engrave(`[Tick] d:${d_t} -> d':${d_next} | ${shortQ}`);
+    const shortThought =
+      typeof transition.thought === 'string'
+        ? transition.thought.split('\n').find((line) => line.trim().length > 0)?.slice(0, 80) ?? ''
+        : '';
+    const stackOp = transition.stack_op ?? 'NOP';
+    const stackNote =
+      stackOp === 'PUSH'
+        ? `${stackOp}(${(transition.stack_payload ?? '').slice(0, 40)})`
+        : stackOp;
+    await this.chronos.engrave(
+      `[Tick] d:${d_t} -> d':${d_next} | ${shortQ} | stack:${stackNote} | thought:${shortThought || '-'}`
+    );
 
     return [q_next, d_next];
   }
@@ -247,4 +313,48 @@ export class TuringEngine {
   private systemTrapPointer(base: string, details: string): Pointer {
     return `${base}?details=${encodeURIComponent(details)}`;
   }
+
+  private actionSignature(dNext: Pointer, sPrime: string): string {
+    return createHash('sha256')
+      .update(`${dNext}|${sPrime.slice(0, 120)}`)
+      .digest('hex');
+  }
+
+  private renderL1Trace(): string {
+    if (this.l1TraceCache.length === 0) {
+      return '(empty)';
+    }
+
+    return this.l1TraceCache
+      .map((hash, idx) => `${idx + 1}. ${hash.slice(0, 12)}`)
+      .join('\n');
+  }
+
+  private async observeCallStackSnapshot(): Promise<string> {
+    try {
+      return await this.manifold.observe('sys://callstack');
+    } catch (error: unknown) {
+      const message = error instanceof Error ? error.message : String(error);
+      return `[SYSTEM_CHANNEL] sys://callstack\n[DETAILS]\nUnavailable: ${message}`;
+    }
+  }
+
+  private async applyStackSyscall(transition: Transition): Promise<void> {
+    const op = transition.stack_op ?? 'NOP';
+    if (op === 'NOP') {
+      return;
+    }
+
+    if (op === 'POP') {
+      await this.manifold.interfere('sys://callstack', 'POP');
+      return;
+    }
+
+    const payload = (transition.stack_payload ?? '').trim();
+    if (payload.length === 0) {
+      throw new Error('PUSH requires stack_payload.');
+    }
+
+    await this.manifold.interfere('sys://callstack', `PUSH: ${payload}`);
+  }
 }
diff --git a/src/kernel/types.ts b/src/kernel/types.ts
index acff58a..569738a 100644
--- a/src/kernel/types.ts
+++ b/src/kernel/types.ts
@@ -2,10 +2,15 @@ export type State = string;
 export type Pointer = string;
 export type Slice = string;
 
+export type StackOp = 'PUSH' | 'POP' | 'NOP';
+
 export interface Transition {
+  thought?: string;
   q_next: State;
   s_prime: string;
   d_next: Pointer;
+  stack_op?: StackOp;
+  stack_payload?: string;
 }
 
 export interface IOracle {
diff --git a/src/manifold/local-manifold.ts b/src/manifold/local-manifold.ts
index 63b4b97..02cec21 100644
--- a/src/manifold/local-manifold.ts
+++ b/src/manifold/local-manifold.ts
@@ -5,14 +5,22 @@ import { IPhysicalManifold, Pointer, Slice } from '../kernel/types.js';
 
 export interface LocalManifoldOptions {
   timeoutMs?: number;
+  maxSliceChars?: number;
 }
 
 export class LocalManifold implements IPhysicalManifold {
   private timeoutMs: number;
+  private maxSliceChars: number;
+  private callStackFile: string;
 
   constructor(private workspaceDir: string, options: LocalManifoldOptions = {}) {
     this.timeoutMs = options.timeoutMs ?? 120_000;
+    this.maxSliceChars = options.maxSliceChars ?? 3000;
     fs.mkdirSync(this.workspaceDir, { recursive: true });
+    this.callStackFile = path.join(this.workspaceDir, '.callstack.json');
+    if (!fs.existsSync(this.callStackFile)) {
+      fs.writeFileSync(this.callStackFile, '[]\n', 'utf-8');
+    }
   }
 
   public async observe(pointer: Pointer): Promise<Slice> {
@@ -23,7 +31,7 @@ export class LocalManifold implements IPhysicalManifold {
     }
 
     if (trimmed.startsWith('sys://')) {
-      return this.observeSystemChannel(trimmed);
+      return this.guardSlice(this.observeSystemChannel(trimmed), `system:${trimmed}`);
     }
 
     if (trimmed.startsWith('$')) {
@@ -33,10 +41,10 @@ export class LocalManifold implements IPhysicalManifold {
 
     const filePath = this.resolveWorkspacePath(trimmed);
     if (!fs.existsSync(filePath)) {
-      throw new Error(`File not found: ${trimmed}`);
+      throw new Error(this.buildPageFaultDetails(trimmed, filePath));
     }
 
-    return fs.readFileSync(filePath, 'utf-8');
+    return this.guardSlice(fs.readFileSync(filePath, 'utf-8'), `file:${trimmed}`);
   }
 
   public async interfere(pointer: Pointer, payload: string): Promise<void> {
@@ -73,6 +81,11 @@ export class LocalManifold implements IPhysicalManifold {
       return;
     }
 
+    if (trimmed === 'sys://callstack') {
+      this.applyCallStackSyscall(payload);
+      return;
+    }
+
     if (trimmed.startsWith('sys://')) {
       return;
     }
@@ -104,6 +117,10 @@ export class LocalManifold implements IPhysicalManifold {
     const params = new URLSearchParams(query);
     const details = params.get('details');
 
+    if (base === 'sys://callstack') {
+      return this.renderCallStackSnapshot(base);
+    }
+
     if (base.startsWith('sys://append/')) {
       const target = base.slice('sys://append/'.length);
       let current = '(empty)';
@@ -170,7 +187,7 @@ export class LocalManifold implements IPhysicalManifold {
   }
 
   private formatCommandSlice(command: string, exitCode: number, stdout: string, stderr: string): string {
-    return [
+    const rawSlice = [
       `[COMMAND] ${command}`,
       `[EXIT_CODE] ${exitCode}`,
       '[STDOUT]',
@@ -178,5 +195,109 @@ export class LocalManifold implements IPhysicalManifold {
       '[STDERR]',
       stderr,
     ].join('\n');
+
+    return this.guardSlice(rawSlice, `command:${command}`);
+  }
+
+  private buildPageFaultDetails(pointer: string, filePath: string): string {
+    const parentDir = path.dirname(filePath);
+    const relativeParent = path.relative(this.workspaceDir, parentDir).replace(/\\/g, '/') || '.';
+
+    if (fs.existsSync(parentDir)) {
+      try {
+        const entries = fs.readdirSync(parentDir).slice(0, 20);
+        const listing = entries.length > 0 ? entries.join(', ') : '(empty)';
+        return `File not found: ${pointer}. Parent=${relativeParent}. Entries=${listing}`;
+      } catch (error: unknown) {
+        const message = error instanceof Error ? error.message : String(error);
+        return `File not found: ${pointer}. Parent=${relativeParent}. Directory listing failed: ${message}`;
+      }
+    }
+
+    return `File not found: ${pointer}. Parent directory does not exist: ${relativeParent}`;
+  }
+
+  private guardSlice(slice: string, source: string): string {
+    if (slice.length <= this.maxSliceChars) {
+      return slice;
+    }
+
+    const truncated = slice.slice(0, this.maxSliceChars);
+    return [
+      truncated,
+      '',
+      '[OS_TRAP: MMU_TRUNCATED]',
+      `Source=${source}`,
+      `OriginalChars=${slice.length}`,
+      `TruncatedTo=${this.maxSliceChars}`,
+      'Action: Narrow I/O scope with grep/head/tail/sed and retry.',
+    ].join('\n');
+  }
+
+  private renderCallStackSnapshot(channel: string): string {
+    const stack = this.readCallStack();
+    const top = stack.length > 0 ? stack[stack.length - 1] : '(empty)';
+    const frames = stack.length > 0 ? stack.map((item, idx) => `${idx + 1}. ${item}`).join('\n') : '(empty)';
+
+    return [
+      `[SYSTEM_CHANNEL] ${channel}`,
+      `[CALL_STACK_DEPTH] ${stack.length}`,
+      `[CALL_STACK_TOP] ${top}`,
+      '[CALL_STACK]',
+      frames,
+      'Action: use stack_op PUSH/POP/NOP and stack_payload in JSON syscall.',
+    ].join('\n');
+  }
+
+  private applyCallStackSyscall(payload: string): void {
+    const instruction = payload.trim();
+    const stack = this.readCallStack();
+
+    if (instruction.length === 0 || instruction.toUpperCase() === 'NOP') {
+      return;
+    }
+
+    if (instruction.toUpperCase() === 'POP') {
+      if (stack.length > 0) {
+        stack.pop();
+        this.writeCallStack(stack);
+      }
+      return;
+    }
+
+    const pushMatch = instruction.match(/^PUSH\s*:?\s*(.+)$/is);
+    if (pushMatch?.[1]) {
+      const task = pushMatch[1].trim().replace(/\s+/g, ' ');
+      if (task.length === 0) {
+        throw new Error('PUSH payload is empty.');
+      }
+
+      stack.push(task.slice(0, 200));
+      this.writeCallStack(stack);
+      return;
+    }
+
+    throw new Error(`Invalid callstack syscall payload: "${instruction}"`);
+  }
+
+  private readCallStack(): string[] {
+    try {
+      const raw = fs.readFileSync(this.callStackFile, 'utf-8');
+      const parsed = JSON.parse(raw) as unknown;
+      if (!Array.isArray(parsed)) {
+        return [];
+      }
+
+      return parsed
+        .filter((value): value is string => typeof value === 'string')
+        .map((value) => value.trim())
+        .filter((value) => value.length > 0);
+    } catch {
+      return [];
+    }
+  }
+
+  private writeCallStack(stack: string[]): void {
+    fs.writeFileSync(this.callStackFile, `${JSON.stringify(stack, null, 2)}\n`, 'utf-8');
   }
 }
diff --git a/src/oracle/universal-oracle.ts b/src/oracle/universal-oracle.ts
index 409d48f..94dedb0 100644
--- a/src/oracle/universal-oracle.ts
+++ b/src/oracle/universal-oracle.ts
@@ -1,8 +1,55 @@
 import OpenAI from 'openai';
-import { IOracle, Slice, State, Transition } from '../kernel/types.js';
+import { IOracle, Slice, StackOp, State, Transition } from '../kernel/types.js';
+
+type OracleMode = 'openai' | 'kimi';
+
+interface KimiMessageBlock {
+  type?: string;
+  text?: string;
+}
+
+interface KimiMessageResponse {
+  content?: KimiMessageBlock[];
+}
+
+interface UniversalOracleConfig {
+  apiKey: string;
+  model: string;
+  baseURL?: string;
+  maxOutputTokens?: number;
+}
 
 export class UniversalOracle implements IOracle {
-  constructor(private client: OpenAI, private model: string) {}
+  private openai?: OpenAI;
+  private model: string;
+  private kimimart?: {
+    endpoint: string;
+    apiKey: string;
+    model: string;
+    maxOutputTokens: number;
+  };
+
+  constructor(private mode: OracleMode, config: UniversalOracleConfig) {
+    this.model = config.model;
+    if (mode === 'openai') {
+      const clientConfig: { apiKey: string; baseURL?: string } = { apiKey: config.apiKey };
+      if (config.baseURL) {
+        clientConfig.baseURL = config.baseURL;
+      }
+      this.openai = new OpenAI(clientConfig);
+    } else if (mode === 'kimi') {
+      const baseURL = config.baseURL ?? 'https://api.kimi.com/coding';
+      const normalized = baseURL.replace(/\/+$/, '');
+      const endpoint = normalized.endsWith('/v1') ? `${normalized}/messages` : `${normalized}/v1/messages`;
+
+      this.kimimart = {
+        endpoint,
+        apiKey: config.apiKey,
+        model: config.model,
+        maxOutputTokens: config.maxOutputTokens ?? 1024,
+      };
+    }
+  }
 
   public async collapse(discipline: string, q: State, s: Slice): Promise<Transition> {
     const prompt = [
@@ -17,28 +64,98 @@ export class UniversalOracle implements IOracle {
       s,
     ].join('\n');
 
-    const response = await this.client.chat.completions.create({
-      model: this.model,
-      messages: [{ role: 'user', content: prompt }],
-      temperature: 0,
-      response_format: { type: 'json_object' },
-    });
+    const rawOutput = await this.request(prompt);
+    return this.parseTransition(rawOutput);
+  }
+
+  private async request(prompt: string): Promise<string> {
+    if (this.mode === 'openai' && this.openai) {
+      const response = await this.openai.chat.completions.create({
+        model: this.model,
+        messages: [{ role: 'user', content: prompt }],
+        temperature: 0,
+        response_format: { type: 'json_object' },
+      });
+      return response.choices[0]?.message?.content ?? '{}';
+    }
+
+    if (this.mode === 'kimi' && this.kimimart) {
+      const response = await fetch(this.kimimart.endpoint, {
+        method: 'POST',
+        headers: {
+          'content-type': 'application/json',
+          'anthropic-version': '2023-06-01',
+          'x-api-key': this.kimimart.apiKey,
+        },
+        body: JSON.stringify({
+          model: this.kimimart.model,
+          max_tokens: this.kimimart.maxOutputTokens,
+          temperature: 0,
+          messages: [{ role: 'user', content: prompt }],
+        }),
+      });
+
+      const raw = await response.text();
+      if (!response.ok) {
+        throw new Error(`Kimi API ${response.status}: ${raw.slice(0, 500)}`);
+      }
+
+      let parsed: KimiMessageResponse;
+      try {
+        parsed = JSON.parse(raw) as KimiMessageResponse;
+      } catch (error: unknown) {
+        const message = error instanceof Error ? error.message : String(error);
+        throw new Error(`Invalid Kimi response JSON: ${message}. Raw: ${raw.slice(0, 500)}`);
+      }
+
+      const text = (parsed.content ?? [])
+        .filter((block) => block.type === 'text' && typeof block.text === 'string')
+        .map((block) => block.text?.trim() ?? '')
+        .filter((line) => line.length > 0)
+        .join('\n');
+
+      if (text.length === 0) {
+        throw new Error(`Empty model output. Raw: ${raw.slice(0, 500)}`);
+      }
+
+      return text;
+    }
+
+    throw new Error('Oracle not configured');
+  }
+
+  private parseTransition(rawOutput: string): Transition {
+    const extractedThought = this.extractThought(rawOutput);
+    const candidates: string[] = [rawOutput];
 
-    const rawOutput = response.choices[0]?.message?.content ?? '{}';
+    // Some models wrap JSON in markdown fences, so we try fenced body too.
+    const fencedMatch = rawOutput.match(/```(?:json)?\s*([\s\S]*?)```/i);
+    if (fencedMatch?.[1]) {
+      candidates.push(fencedMatch[1].trim());
+    }
 
-    let parsed: unknown;
-    try {
-      parsed = JSON.parse(rawOutput);
-    } catch (error: unknown) {
-      const message = error instanceof Error ? error.message : String(error);
-      throw new Error(`Invalid ALU output JSON: ${message}. Raw: ${rawOutput}`);
+    const firstBrace = rawOutput.indexOf('{');
+    const lastBrace = rawOutput.lastIndexOf('}');
+    if (firstBrace >= 0 && lastBrace > firstBrace) {
+      candidates.push(rawOutput.slice(firstBrace, lastBrace + 1));
     }
 
-    if (!this.isTransition(parsed)) {
-      throw new Error(`Invalid ALU output shape. Raw: ${rawOutput}`);
+    for (const candidate of candidates) {
+      try {
+        const parsed = JSON.parse(candidate);
+        if (this.isTransition(parsed)) {
+          const normalized = this.normalizeTransition(parsed);
+          if (!normalized.thought && extractedThought) {
+            normalized.thought = extractedThought;
+          }
+          return normalized;
+        }
+      } catch {
+        // Try next candidate shape.
+      }
     }
 
-    return parsed;
+    throw new Error(`Invalid ALU output shape. Raw: ${rawOutput}`);
   }
 
   private isTransition(value: unknown): value is Transition {
@@ -53,4 +170,50 @@ export class UniversalOracle implements IOracle {
       typeof asRecord.d_next === 'string'
     );
   }
+
+  private extractThought(rawOutput: string): string | undefined {
+    const thoughtMatch = rawOutput.match(/<thought>([\s\S]*?)<\/thought>/i);
+    if (!thoughtMatch?.[1]) {
+      return undefined;
+    }
+
+    const thought = thoughtMatch[1].trim();
+    return thought.length > 0 ? thought : undefined;
+  }
+
+  private normalizeTransition(value: Transition): Transition {
+    const normalized: Transition = {
+      q_next: value.q_next,
+      s_prime: value.s_prime,
+      d_next: value.d_next,
+    };
+
+    if (typeof value.thought === 'string' && value.thought.trim().length > 0) {
+      normalized.thought = value.thought.trim();
+    }
+
+    const stackOp = this.normalizeStackOp(value.stack_op);
+    if (stackOp) {
+      normalized.stack_op = stackOp;
+    }
+
+    if (typeof value.stack_payload === 'string' && value.stack_payload.trim().length > 0) {
+      normalized.stack_payload = value.stack_payload.trim();
+    }
+
+    return normalized;
+  }
+
+  private normalizeStackOp(value: unknown): StackOp | undefined {
+    if (typeof value !== 'string') {
+      return undefined;
+    }
+
+    const upper = value.trim().toUpperCase();
+    if (upper === 'PUSH' || upper === 'POP' || upper === 'NOP') {
+      return upper;
+    }
+
+    return undefined;
+  }
 }
diff --git a/src/runtime/boot.ts b/src/runtime/boot.ts
index a12021b..3cf5b67 100644
--- a/src/runtime/boot.ts
+++ b/src/runtime/boot.ts
@@ -1,11 +1,9 @@
 import 'dotenv/config';
 import fs from 'node:fs';
 import path from 'node:path';
-import OpenAI from 'openai';
 import { FileChronos } from '../chronos/file-chronos.js';
 import { TuringEngine } from '../kernel/engine.js';
 import { LocalManifold } from '../manifold/local-manifold.js';
-import { KimiCodeOracle } from '../oracle/kimi-code-oracle.js';
 import { MockOracle } from '../oracle/mock-oracle.js';
 import { UniversalOracle } from '../oracle/universal-oracle.js';
 import { FileExecutionContract } from './file-execution-contract.js';
@@ -99,11 +97,10 @@ async function main(): Promise<void> {
       return new MockOracle();
     }
 
-    const usingKimi = oracleMode === 'kimi';
-    const apiKey = usingKimi ? process.env.KIMI_API_KEY ?? process.env.OPENAI_API_KEY : process.env.OPENAI_API_KEY;
+    const apiKey = oracleMode === 'kimi' ? process.env.KIMI_API_KEY ?? process.env.OPENAI_API_KEY : process.env.OPENAI_API_KEY;
     if (!apiKey) {
       console.warn(
-        usingKimi
+        oracleMode === 'kimi'
           ? '[turingos] KIMI_API_KEY missing. Falling back to mock oracle.'
           : '[turingos] OPENAI_API_KEY missing. Falling back to mock oracle.'
       );
@@ -111,16 +108,12 @@ async function main(): Promise<void> {
     }
 
     const baseURL = process.env.TURINGOS_API_BASE_URL;
-    if (usingKimi) {
-      return new KimiCodeOracle(apiKey, model, baseURL ?? 'https://api.kimi.com/coding', maxOutputTokens);
-    }
-
-    const clientConfig: { apiKey: string; baseURL?: string } = { apiKey };
-    if (baseURL) {
-      clientConfig.baseURL = baseURL;
-    }
-
-    return new UniversalOracle(new OpenAI(clientConfig), model);
+    return new UniversalOracle(oracleMode, {
+      apiKey,
+      model,
+      baseURL,
+      maxOutputTokens,
+    });
   })();
 
   const engine = new TuringEngine(manifold, oracle, chronos, disciplinePrompt, executionContract ?? undefined);
diff --git a/turing_prompt.sh b/turing_prompt.sh
index ea66eb8..87baa04 100644
--- a/turing_prompt.sh
+++ b/turing_prompt.sh
@@ -6,20 +6,27 @@ You are stateless. Your continuity exists only in State Register `q`.
 ## INPUTS
 1. `[STATE REG] q`: persistent intention and todo stack.
 2. `[DATA BUS] s`: observed slice at current pointer.
+3. `[OS_CALL_STACK]`: OS-managed call stack summary injected by kernel.
+4. `[L1_TRACE_CACHE]`: recent action signatures for loop detection.
 
 ## OUTPUT PROTOCOL
 Output exactly one strict JSON object, with no markdown wrapper:
 
 {
+  "thought": "string (optional but recommended, concise plan for this tick)",
   "q_next": "string",
   "s_prime": "string",
-  "d_next": "string"
+  "d_next": "string",
+  "stack_op": "PUSH|POP|NOP",
+  "stack_payload": "string (required only when stack_op=PUSH)"
 }
 
 Use `s_prime = "👆🏻"` when no write is needed.
+Use `d_next = "sys://callstack"` only when you need to inspect call stack details.
 
 ## LAWS
 1. Errors are physics, not failure.
 2. If `s` contains traps or stderr, push a corrective task in `q_next`.
 3. Avoid repeated failed strategies.
 4. Do not emit `d_next: "HALT"` until objective completion is physically verified.
+5. Use `stack_op=PUSH` before entering a sub-problem; use `stack_op=POP` after sub-problem resolution.
```
