# 1M Test Progress & Planner Halt Bugfix (2026-03-04)

## Test Execution Result
- **Status:** Test halted on Mac runner.
- **Longest Consecutive Pass:** 105 successful cases.
- **Failure Point:** Case 106. The test failed because the model returned a `null` response.

## Debugging & Root Cause Analysis
Analysis of the `case_000106` trace revealed a critical flaw in the `SYS_EXEC_PYTHON` handler within `src/kernel/scheduler.ts` concerning the planner's auto-halt mechanism.

1. **Hallucinated Script:** On case 106, the Qwen 3.5 27B planner emitted a Python script that merely read and printed the raw contents of `MAIN_TAPE.md` instead of parsing and computing the math expression.
   ```python
   with open('MAIN_TAPE.md', 'r') as f: tape = f.read(); print(tape)
   ```
2. **Strict Integer Write Violation:** The script executed successfully, but its standard output was the full prompt text rather than a single integer. The kernel automatically attempted to `SYS_WRITE` this massive text blob to `ANSWER.txt`. Because `TURINGOS_HYPERCORE_STRICT_INTEGER_WRITE_COERCE=0` was set, this triggered a `STRICT_INTEGER_WRITE_REJECTED` exception.
3. **Kernel Halt Deadlock:** The `executeWorldOp(pcb, { op: 'SYS_WRITE', ... })` call in the `SYS_EXEC_PYTHON` planner auto-halt branch threw an exception. Because this exception was unhandled, the subsequent assignment `pcb.state = 'PENDING_HALT'` was never reached. The planner was trapped in a `RUNNING` state without having advanced its `q` or `d` pointers meaningfully, leading immediately to an unrecoverable `TRAP_ROUTE_THRASHING` and `TRAP_THRASHING_NO_PHYSICAL_IO` death spiral.

## Fix Implemented
Modifications were made to `src/kernel/scheduler.ts`:
1. **Pre-Write Output Validation:** Before attempting to `SYS_WRITE` the Python script's result, the kernel now strictly checks if the result matches `/^-?\d+$/`.
2. **Error Injection via Q Register:** If the planner's Python output is not a strict integer, the system aborts the auto-halt procedure and injects a `[PYTHON_EXEC_ERROR]` describing the faulty output directly into the planner's `q` register. This allows the LLM to observe its mistake and attempt a new script on the next tick.
3. **Safe Auto-Halt:** Wrapped the `executeWorldOp` call in a `try/catch` block to guarantee that even if a write fails, the system safely records the `[SYS_WRITE_ERROR]` without deadlocking the process control block.

This hardens the TuringOS planner lane against non-deterministic script outputs, ensuring the system can retry or cleanly fail rather than thrashing.