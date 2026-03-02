# Goal-Driven 1M Growth Design for TuringOS (2026-03-01)

## Mission Lock

TuringOS current cycle must optimize for two hard goals:

1. Never-stop objective persistence:
   - under finite failure probability per step, system can keep advancing toward a fixed objective without drift;
   - if one run halts, supervisor must resume from deterministic cursor.
2. Collective intelligence scaling:
   - with increasing worker count and diversity, ensemble capability must exceed any single worker in reliability and long-horizon completion.

Final hard gate remains:

- `steps >= 1_000_000`
- deterministic final answer verification passed.

Reference: `final_success_criterion_maker_1m_steps_20260228.md`.

## Why 1M Test Is a Growth Engine (Not Just Benchmark)

Treat 1M test as continuous architecture search:

- online detector: exposes failure mode as soon as it appears;
- replay dataset builder: every fail artifact becomes a deterministic regression item;
- controller tuning loop: worker fanout, routing, rollback, and red-flag policy are tuned by measured evidence.

## Paper-Aligned Reliability Model (arXiv:2511.09030v1)

Use majority consensus from parallel workers to reduce per-step error propagation.

For single-worker pass probability `p`, with `2K+1` workers and majority vote, aggregate pass probability is:

`p_agg = sum_{i=0..K} C(2K+1, i) * p^(2K+1-i) * (1-p)^i`

Long-horizon reliability target:

`p_agg^N >= R_target`

where `N = 1_000_000`, `R_target` suggested `0.99`.

Engineering implication:

- fixed 16 workers is a pragmatic warm baseline near the paper's `K~8` scale point (`2K+1=17`), but should be treated as operational compromise, not theorem optimum.

## System Invariants for Goal 1 (Never-Stop + No Drift)

Every test run must enforce:

1. Goal lock invariant:
   - each tick input must include immutable mission objective and non-negotiable success condition.
2. Markov-state invariant:
   - decision is made from current absolute state + last step result, not unbounded dirty history.
3. Contract invariant:
   - syscall frame and output format are grammar-constrained, not prompt-only constrained.
4. Progress invariant:
   - repeated non-progress signatures trigger hard interrupt (red flag), not infinite retries.
5. Resume invariant:
   - on first failure, write deterministic cursor (`firstFailAt`) and artifact bundle; next run resumes from cursor after patch.

## Collective Intelligence Criteria for Goal 2

Do not define "more workers" as success. Define ensemble lift explicitly:

1. Reliability lift:
   - `pass_rate(ensemble) > max(pass_rate(single_worker_i))`.
2. Horizon lift:
   - median consecutive passes before first fail is strictly higher than best single worker.
3. Recovery lift:
   - lower mean time to recover from fail (MTTR) using disagreement-aware routing.
4. Cost-normalized lift:
   - reliability gain per unit token/latency remains positive.

If any metric is not positive, worker scaling is pseudo-parallelism and must be rolled back.

## 1M Growth Loop (Run Until Fail -> Debug -> Resume)

### Outer loop

1. Launch from current cursor with `stopOnFirstFail=true`.
2. Fail happens -> capture artifact -> classify failure type.
3. Patch one mechanism only (single-variable change).
4. Replay historical fail set + short canary.
5. If canary pass, resume from same cursor; otherwise rollback patch.

### Failure taxonomy (mandatory)

- F1: contract/format drift (e.g., non-digit `ANSWER.txt`)
- F2: non-termination / stuck READY
- F3: consensus deadlock / no valid vote
- F4: environment contamination across cases
- F5: infra/network/model serving instability

Each patch must bind to exactly one primary failure type.

## Stage Gates (2026-03 Cycle)

### G0: Stability Seed

- worker parallelism fixed at 16;
- target: consecutive pass >= 50 on arithmetic baseline;
- zero tolerance: F1 contract drift.

### G1: Longrun Discipline

- single detached run until first fail;
- target: consecutive pass >= 200;
- enforce red-flag interrupt on non-progress loops.

### G2: Ensemble Lift Validation

- A/B at worker 8 vs 16 vs 24 (same test interval);
- promote only if ensemble lift metrics all positive.

### G3: 1K to 10K Cursor Expansion

- rolling resume across failures;
- fail replay suite grows monotonically.

### G4: 100K to 1M Campaign

- hierarchical dispatch (planner lane + worker pool lanes);
- no manual per-case intervention, only policy-level patching between runs.

## Required Telemetry Additions (if missing)

Per-case report should include:

- rootState, ticks, redFlags, timeout count;
- map-reduce usage and early stop ratio;
- worker endpoints used;
- failure type label F1..F5.

Per-run report should include:

- p50/p95 ticks;
- consensus success ratio;
- kill ratio and resume success ratio;
- ensemble lift vs single-worker control.

## Immediate Priority from Current Evidence

Current latest baseline report (`20260301_140916`) failed at case `1102`:

- root state remained `READY` (not terminated);
- answer file became expression string instead of bare integer format.

So priority is F1+F2 hardening before any worker expansion.

## Operational Rule

- Keep `omega-vm` as controller.
- Mac = planner primary lane.
- Mac + Windows = worker compute lanes (LAN preferred for large artifact movement).
- Scale workers only after passing gate metrics, never by intuition.

## Source Links

- arXiv reference: https://arxiv.org/html/2511.09030v1
- success gate lock doc: `handover/artitecture_response/final_success_criterion_maker_1m_steps_20260228.md`
- current recursive plan: `handover/artitecture_response/dual_llm_recursive_upgrade_execution_plan_20260301.md`
