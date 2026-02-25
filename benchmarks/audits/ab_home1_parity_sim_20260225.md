# A/B Test: home1 parity simulation (2026-02-25)

## Task

- Traverse `./$home1` directory tree using `.ls` files.
- Read all numeric `*.md` files.
- Output only parity result (`odd`/`even`) to `./$home1/result.md`.
- Expected answer for provided fixture: `odd`.

## Run commands

### turingclaw

```bash
cd /home/zephryj/projects/turingclaw
npm run test:control-real-llm -- --scenario home1_parity_sim --repeats 1
```

### turingos

```bash
cd /home/zephryj/projects/turingos
npm run bench:os-longrun -- --scenario home1_parity_sim --repeats 1
```

## Results

| System | Scenario | Pass | Halt | Artifact check | Ticks | MaxTickHit |
|---|---|---:|---:|---:|---:|---:|
| turingclaw | home1_parity_sim | 1/1 | Yes | 1/1 | 72 | No |
| turingos | home1_parity_sim | 0/1 | No | 0/1 | 79 observed / 120 max | Yes |

## Key failure signal comparison

- turingclaw:
  - Reached `HALT` with `result.md = odd`.
  - No anomalies/trap hits/loop recoveries.

- turingos:
  - Did not halt within max ticks.
  - `IO_FAULT` repeated heavily, then `L1_CACHE_HIT` recovery loop.
  - Final `result.md` check failed (text mismatch).

## Raw evidence

- turingclaw markdown report:
  - `/home/zephryj/projects/turingclaw/workspace/benchmarks/control_real_llm/control-real-20260225-191334.md`
- turingclaw json report:
  - `/home/zephryj/projects/turingclaw/workspace/benchmarks/control_real_llm/control-real-20260225-191334.json`
- turingos markdown report:
  - `/home/zephryj/projects/turingos/benchmarks/results/os-longrun-20260225-191537.md`
- turingos json report:
  - `/home/zephryj/projects/turingos/benchmarks/results/os-longrun-20260225-191537.json`

## Scenario artifacts used

- turingclaw contract:
  - `/home/zephryj/projects/turingclaw/tests/new/contracts/control_real_llm/home1_parity_sim.json`
- turingos scenario implementation:
  - `/home/zephryj/projects/turingos/src/bench/os-longrun.ts` (scenario id `home1_parity_sim`)
