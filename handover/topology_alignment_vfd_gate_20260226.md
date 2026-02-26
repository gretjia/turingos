# TuringOS Topology v3.0 Alignment Gate (vFD + Merkle)

Date: 2026-02-26
Repo: `projects/turingos`

## Scope
This gate validates alignment for the following topology requirements:

- Layer 4: deterministic append-only tape log with hash-chain evidence
- Layer 3: typed pager and semantic capability gate (vFD)
- Layer 2: ISA/ABI support for capability-targeted writes (`SYS_WRITE.semantic_cap`)

## Code Changes (this gate)

1. `src/manifold/local-manifold.ts`
- Completed Semantic Capability(vFD) control plane and persistence.
- Added capability file: `.vfd_caps.json`.
- Added channels:
  - `sys://cap/issue/<pointer>?access=r|w|rw`
  - `sys://cap/list`
  - `sys://cap/describe/<url-encoded-vfd-handle>`
- Added handle resolution and permission enforcement (`EACCES`) for `vfd://...` pointers.
- Integrated vFD resolution in both `observe()` and `interfere()`.

2. `src/kernel/types.ts`
- Extended `SYS_WRITE` ABI:
  - from `{ op: 'SYS_WRITE'; payload: string }`
  - to `{ op: 'SYS_WRITE'; payload: string; semantic_cap?: Pointer }`

3. `src/oracle/universal-oracle.ts`
- Parser now accepts optional capability fields for `SYS_WRITE`:
  - `semantic_cap`, `semanticCap`, `cap`, `capability`

4. `src/kernel/engine.ts`
- Dispatch now honors `SYS_WRITE.semantic_cap` as effective write target.
- Preserved pointer progression semantics (`d_next` remains backward-compatible).
- Syscall trace now records capability usage in `SYS_WRITE(...)` note.

5. Prompt alignment
- `turing_prompt.sh`
- `benchmarks/os-longrun/discipline_prompt.txt`
- Added ABI docs for `semantic_cap` and capability channels.

6. Automated acceptance gate
- Added `src/bench/topology-v3-gate.ts`
- Added npm script: `bench:topology-v3-gate`
- Gate checks:
  - typed paging page-table navigation
  - vFD issue/read/write + read-only denial
  - engine dispatch of `SYS_WRITE.semantic_cap`
  - Merkle journal hash-chain integrity

## Evidence

### 1) Type safety
Command:
- `npm run typecheck`

Result:
- PASS (`tsc -p tsconfig.json --noEmit`)

### 1.1) Automated topology acceptance gate
Command:
- `npm run bench:topology-v3-gate`

Result:
- PASS (4/4)
- Output:
  - `PASS Typed Paging`
  - `PASS Semantic Capability`
  - `PASS Engine SYS_WRITE.semantic_cap`
  - `PASS Merkle Journal Chain`

### 2) vFD read/write permission behavior (manifold-level)
Command (executed via `tsx -e`):
- issue rw handle, read via handle, write via handle
- issue r handle, verify write is blocked

Observed result:
```json
{
  "ws": "/tmp/turingos-vfd-wkosUp",
  "handle": "vfd://rw/726eb4aab660/notes.txt",
  "readViaHandle": "hello",
  "afterWrite": "world",
  "readOnlyWriteBlocked": true
}
```

### 3) Engine ABI integration (`SYS_WRITE.semantic_cap`)
Command (executed via `tsx -e`):
- custom oracle emits `SYS_WRITE` with `semantic_cap`
- engine tick writes to capability target

Observed result:
```json
{
  "ws": "/tmp/turingos-engine-cap-cew91Y",
  "handle": "vfd://rw/5a0f90f781da/out.txt",
  "q1": "q_cap_write",
  "d1": "MAIN_TAPE.md",
  "out": "CAP_OK"
}
```

### 4) Layer-4 append-only hash-chain log
Command:
- run smoke in clean temp workspace
- inspect `.journal.merkle.jsonl`

Observed evidence:
- File exists: `/tmp/turingos-align-vfd-I2BbzC/.journal.merkle.jsonl`
- Entries include `prev_hash` -> `hash` chaining from `GENESIS`.

## Topology Mapping Status

- Layer 4 (Infinite Tape / append-only + hash-chain): ALIGNED (Merkle-like chain present)
- Layer 3 (Typed Pager): ALIGNED (already present; unchanged in this gate)
- Layer 3 (Semantic Capability engine): ALIGNED (vFD issue/list/describe + enforce)
- Layer 2 (ISA/ABI syscalls): ALIGNED (`SYS_WRITE.semantic_cap` wired end-to-end)
- Layer 1 (multi-socket ALU orchestration): PARTIAL (current code remains single-oracle runtime)

## Known Remaining Gap (for next gate)

1. Multi-ALU socket scheduling (`P/E/V/S`) is not yet implemented in runtime orchestration.
2. Capability issuance policy is functional but permissive; fine-grained policy/TTL/revocation is pending.
