# TuringOS v0.1 Architecture

## Transition contract

```text
delta(q, s) -> (q_next, s_prime, d_next)
```

Inputs each tick:

- `q`: state register
- `d`: pointer register
- `s`: observed slice at pointer `d`

Outputs each tick:

- `q_next`: next state register value
- `s_prime`: payload to write (or `👆🏻` for no-write)
- `d_next`: next pointer

## Runtime flow

1. Boot loads or initializes `.reg_q` and `.reg_d`.
2. Engine asks manifold to observe current pointer.
3. Oracle computes transition JSON.
4. Engine enforces traps/watchdog discipline.
5. Manifold applies `s_prime` write when needed.
6. Registers are persisted after each tick.
7. Loop stops only on `HALT` or max-tick guard.

## Trap semantics

- `PAGE_FAULT`: observe failure (missing file, invalid pointer).
- `CPU_FAULT`: invalid oracle output (bad JSON/shape/API issues).
- `IO_FAULT`: write failure.
- `WATCHDOG_NMI`: same action repeated 5 times.

Traps are encoded back into `q`/`d` for next tick instead of crashing the runtime.

## Manifold command behavior

Pointer values beginning with `$` execute shell commands.

- Exit `0`: return stdout/stderr slice.
- Non-zero exit: still return slice, including stderr and exit code.
- Timeout: return timeout notice in stderr slice.

This ensures command failures become data for the next transition cycle.
