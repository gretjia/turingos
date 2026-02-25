# Cycle 02 Independent Audit Input

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

## Results
# Cycle 02 Test Results

- Source JSON: benchmarks/results/os-longrun-20260225-104226.json
- Source Markdown: benchmarks/results/os-longrun-20260225-104226.md
- Command log: benchmarks/audits/cycles/20260225_1039_cycle_02/04_test_commands.txt

## Summary
```json
{
  "runStamp": "20260225-104226",
  "model": "kimi-for-coding",
  "repeats": 1,
  "runs": 3,
  "passed": 0,
  "completion_avg": 0.0333,
  "plan_avg": 0.619,
  "drift_avg": 0,
  "traps_avg": {
    "WATCHDOG_NMI": 0,
    "CPU_FAULT": 0,
    "IO_FAULT": 1.6667,
    "PAGE_FAULT": 7.6667
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
      "planAvg": 0,
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
      "planAvg": 1,
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
      "planAvg": 0.8571,
      "driftAvg": 0,
      "haltedRate": 0,
      "maxTickRate": 1,
      "watchdogAvg": 0
    }
  ],
  "results": [
    {
      "repeat": 1,
      "id": "pipeline_ordered_execution",
      "name": "Pipeline Ordered Execution",
      "maxTicks": 28,
      "exitCode": 2,
      "elapsedMs": 128893,
      "halted": false,
      "maxTickHit": true,
      "ticksObserved": 20,
      "completionScore": 0,
      "planAdherence": 0.8571,
      "pointerDriftRate": 0,
      "invalidPointerCount": 0,
      "trapCounts": {
        "PAGE_FAULT": 1,
        "CPU_FAULT": 0,
        "IO_FAULT": 0,
        "WATCHDOG_NMI": 0
      },
      "mustContainTrapSatisfied": true,
      "suspiciousFiles": [],
      "finalQ": "11:HALT",
      "finalD": "sys://trap/halt_guard?details=HALT%20rejected%3A%20acceptance%20contract%20not%20satisfied.%0ADetails%3A%20Plan%20incomplete%20for%20HALT.%20done%3D6%20required%3D7.%0AAction%3A%20Complete%20remaining%20plan%20steps%20and%20required%20files%2C%20then%20HALT.",
      "fileChecks": [
        {
          "path": "artifacts/input.csv",
          "passed": false,
          "reason": "missing file"
        },
        {
          "path": "artifacts/high.csv",
          "passed": false,
          "reason": "missing file"
        },
        {
          "path": "artifacts/sum.txt",
          "passed": false,
          "reason": "missing file"
        },
        {
          "path": "artifacts/manifest.txt",
          "passed": false,
          "reason": "missing file"
        },
        {
          "path": "result/RESULT.json",
          "passed": false,
          "reason": "missing file"
        }
      ],
      "pass": false
    },
    {
      "repeat": 1,
      "id": "fault_recovery_resume",
      "name": "Fault Recovery Resume",
      "maxTicks": 28,
      "exitCode": 2,
      "elapsedMs": 124421,
      "halted": false,
      "maxTickHit": true,
      "ticksObserved": 25,
      "completionScore": 0,
      "planAdherence": 0,
      "pointerDriftRate": 0,
      "invalidPointerCount": 0,
      "trapCounts": {
        "PAGE_FAULT": 20,
        "CPU_FAULT": 0,
        "IO_FAULT": 2,
        "WATCHDOG_NMI": 0
      },
      "mustContainTrapSatisfied": true,
      "suspiciousFiles": [],
      "finalQ": "1. POP recovery frame 2. Append DONE:RESULT 3. Execute step RESULT 4. Append DONE:HALT 5. HALT",
      "finalD": "sys://append/plan/progress.log",
      "fileChecks": [
        {
          "path": "inputs/source.txt",
          "passed": false,
          "reason": "missing file"
        },
        {
          "path": "outputs/colors_upper.txt",
          "passed": false,
          "reason": "missing file"
        },
        {
          "path": "outputs/count.txt",
          "passed": false,
          "reason": "missing file"
        },
        {
          "path": "result/RESULT.json",
          "passed": false,
          "reason": "missing file"
        }
      ],
      "pass": false
    },
    {
      "repeat": 1,
      "id": "long_checklist_stability",
      "name": "Long Checklist Stability",
      "maxTicks": 36,
      "exitCode": 2,
      "elapsedMs": 190739,
      "halted": false,
      "maxTickHit": true,
      "ticksObserved": 29,
      "completionScore": 0.1,
      "planAdherence": 1,
      "pointerDriftRate": 0,
      "invalidPointerCount": 0,
      "trapCounts": {
        "PAGE_FAULT": 2,
        "CPU_FAULT": 0,
        "IO_FAULT": 3,
        "WATCHDOG_NMI": 0
      },
      "mustContainTrapSatisfied": true,
      "suspiciousFiles": [],
      "finalQ": "12c) POP recovery:m03_creation | 12d) Append DONE:03 | 12e) HALT",
      "finalD": "sys://trap/halt_guard",
      "fileChecks": [
        {
          "path": "milestones/m01.txt",
          "passed": false,
          "reason": "text mismatch"
        },
        {
          "path": "milestones/m02.txt",
          "passed": false,
          "reason": "text mismatch"
        },
        {
          "path": "milestones/m03.txt",
          "passed": false,
          "reason": "text mismatch"
        },
        {
          "path": "milestones/m04.txt",
          "passed": false,
          "reason": "missing file"
        },
        {
          "path": "milestones/m05.txt",
          "passed": true
        },
        {
          "path": "milestones/m06.txt",
          "passed": false,
          "reason": "missing file"
        },
        {
          "path": "milestones/m07.txt",
          "passed": false,
          "reason": "missing file"
        },
```

## Compare vs Cycle 01 Post
```json
{
  "passed_before": 0,
  "passed_after": 0,
  "completion_before": 0.0333,
  "completion_after": 0.0333,
  "completion_delta": 0,
  "plan_before": 0.2937,
  "plan_after": 0.619,
  "plan_delta": 0.3253,
  "drift_before": 0,
  "drift_after": 0,
  "drift_delta": 0,
  "watchdog_before": 0,
  "watchdog_after": 0,
  "watchdog_delta": 0,
  "page_fault_before": 3.6667,
  "page_fault_after": 7.6667,
  "page_fault_delta": 4
}
```

## Diff
```diff
diff --git a/benchmarks/os-longrun/discipline_prompt.txt b/benchmarks/os-longrun/discipline_prompt.txt
index ad996c1..61a9772 100644
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
@@ -38,6 +42,8 @@ Trap handling:
 3. If you receive `sys://trap/halt_guard`, inspect `[DETAILS]`, create missing outputs, then continue plan.
 4. Do not repeat identical action more than 2 times; choose a different operation.
 5. If append channel reports duplicate append blocked, advance to the next unfinished step instead of retrying same DONE line.
+6. If you detect short-loop signals (`[OS_TRAP: L1_CACHE_HIT]`), immediately change strategy and consider `stack_op=PUSH`.
+7. Always prioritize `[NEXT_REQUIRED_DONE]` from `[OS_CONTRACT]`; append exactly that one line and do not rewrite full progress log.
 
 HALT law:
 1. HALT only after all required artifacts are physically present and validated.
diff --git a/src/kernel/engine.ts b/src/kernel/engine.ts
index cc62561..f747d33 100644
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
@@ -38,6 +41,8 @@ export class TuringEngine {
   public async tick(q_t: State, d_t: Pointer): Promise<[State, Pointer]> {
     let s_t: Slice;
     const pointer = d_t.trim();
+    let nextRequiredDone: string | null = null;
+    let progressAppendPointer: Pointer | null = null;
 
     // 1) Observe from the physical manifold.
     try {
@@ -60,6 +65,14 @@ export class TuringEngine {
 
     // 1.5) Validate progress contract and feed violations back as trap context.
     if (this.executionContract) {
+      try {
+        nextRequiredDone = await this.executionContract.getNextRequiredStep();
+        const progressPath = this.executionContract.getProgressPath().replace(/^\.\//, '');
+        progressAppendPointer = `sys://append/${progressPath}`;
+      } catch {
+        nextRequiredDone = null;
+      }
+
       try {
         const progressCheck = await this.executionContract.checkProgress();
         if (!progressCheck.ok) {
@@ -115,6 +128,24 @@ export class TuringEngine {
     this.lastObservedPointer = pointer;
     this.lastObservedSlice = s_t;
 
+    // 1.8) Inject managed context channels for short-horizon anti-looping.
+    const callStackSlice = await this.observeCallStackSnapshot();
+    const l1TraceSlice = this.renderL1Trace();
+    const contractSlice = this.renderContractGuidance(nextRequiredDone, progressAppendPointer);
+    s_t = [
+      '[OS_CONTRACT]',
+      contractSlice,
+      '',
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
@@ -135,6 +166,22 @@ export class TuringEngine {
 
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
@@ -167,18 +214,40 @@ export class TuringEngine {
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
@@ -199,8 +268,26 @@ export class TuringEngine {
     // 4) Interfere with physical world unless this is a pure read/exec step.
     const isAppendChannel = pointer.startsWith('sys://append/');
     if (s_prime.trim() !== '👆🏻' && (!pointer.startsWith('sys://') || isAppendChannel)) {
+      let writePayload = s_prime;
+      if (isAppendChannel && progressAppendPointer && pointer === progressAppendPointer) {
+        const normalized = this.normalizeProgressPayload(s_prime, nextRequiredDone);
+        if (!normalized.ok) {
+          return [
+            [
+              q_next,
+              '',
+              `[OS_TRAP: IO_FAULT] Failed to write to ${d_t}: ${normalized.reason}`,
+              `Action: append exact line DONE:${nextRequiredDone ?? '<none>'} once.`,
+            ].join('\n'),
+            'sys://trap/io_fault',
+          ];
+        }
+
+        writePayload = normalized.payload;
+      }
+
       try {
-        await this.manifold.interfere(d_t, s_prime);
+        await this.manifold.interfere(d_t, writePayload);
       } catch (error: unknown) {
         const message = error instanceof Error ? error.message : String(error);
         return [
@@ -216,7 +303,18 @@ export class TuringEngine {
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
@@ -247,4 +345,97 @@ export class TuringEngine {
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
+
+  private renderContractGuidance(nextRequiredDone: string | null, progressAppendPointer: Pointer | null): string {
+    const next = nextRequiredDone ? `DONE:${nextRequiredDone}` : '(complete)';
+    return [
+      `[NEXT_REQUIRED_DONE] ${next}`,
+      `[PROGRESS_APPEND_POINTER] ${progressAppendPointer ?? '(n/a)'}`,
+      'Rule: append exactly one DONE line for NEXT_REQUIRED_DONE; do not rewrite whole progress log.',
+    ].join('\n');
+  }
+
+  private normalizeProgressPayload(
+    payload: string,
+    nextRequiredDone: string | null
+  ): { ok: true; payload: string } | { ok: false; reason: string } {
+    if (!nextRequiredDone) {
+      return { ok: false, reason: 'Plan already complete; no further DONE append allowed.' };
+    }
+
+    const expectedLine = `DONE:${nextRequiredDone}`;
+    const candidate = payload
+      .split('\n')
+      .map((line) => line.trim())
+      .find((line) => line.length > 0);
+
+    if (!candidate) {
+      return { ok: false, reason: 'Empty append payload.' };
+    }
+
+    const compact = candidate.replace(/\s+/g, '').toUpperCase();
+    if (compact === expectedLine.replace(/\s+/g, '').toUpperCase()) {
+      return { ok: true, payload: expectedLine };
+    }
+
+    if (compact === nextRequiredDone.replace(/\s+/g, '').toUpperCase()) {
+      return { ok: true, payload: expectedLine };
+    }
+
+    const doneMatch = candidate.match(/^DONE[:：]\s*(.+)$/i);
+    if (doneMatch?.[1]) {
+      const doneStep = doneMatch[1].trim();
+      if (doneStep === nextRequiredDone || doneStep.includes(nextRequiredDone)) {
+        return { ok: true, payload: expectedLine };
+      }
+    } else if (candidate.includes(nextRequiredDone)) {
+      return { ok: true, payload: expectedLine };
+    }
+
+    return { ok: false, reason: `Progress strictly requires ${expectedLine}, got "${candidate.slice(0, 120)}".` };
+  }
 }
diff --git a/src/kernel/types.ts b/src/kernel/types.ts
index acff58a..3b7039a 100644
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
@@ -29,4 +34,6 @@ export interface ContractCheckResult {
 export interface IExecutionContract {
   checkProgress(): Promise<ContractCheckResult>;
   checkHalt(): Promise<ContractCheckResult>;
+  getNextRequiredStep(): Promise<string | null>;
+  getProgressPath(): string;
 }
diff --git a/src/runtime/file-execution-contract.ts b/src/runtime/file-execution-contract.ts
index ad25633..12206e8 100644
--- a/src/runtime/file-execution-contract.ts
+++ b/src/runtime/file-execution-contract.ts
@@ -103,6 +103,28 @@ export class FileExecutionContract implements IExecutionContract {
     return { ok: true };
   }
 
+  public async getNextRequiredStep(): Promise<string | null> {
+    if (this.config.enabled === false) {
+      return null;
+    }
+
+    const ordered = this.orderedSteps();
+    if (ordered.length === 0) {
+      return null;
+    }
+
+    const done = await this.readDoneSteps();
+    if (done.steps.length >= ordered.length) {
+      return null;
+    }
+
+    return ordered[done.steps.length] ?? null;
+  }
+
+  public getProgressPath(): string {
+    return this.progressPath();
+  }
+
   private orderedSteps(): string[] {
     return (this.config.ordered_steps ?? []).filter((step): step is string => typeof step === 'string');
   }
diff --git a/turing_prompt.sh b/turing_prompt.sh
index ea66eb8..f0f179f 100644
--- a/turing_prompt.sh
+++ b/turing_prompt.sh
@@ -6,20 +6,28 @@ You are stateless. Your continuity exists only in State Register `q`.
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
+6. Follow `[NEXT_REQUIRED_DONE]` from OS contract. For progress append, emit exactly one line `DONE:<STEP_ID>` and never rewrite the entire log.
```
