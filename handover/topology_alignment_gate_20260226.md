# Topology v3.0 对齐验收（2026-02-26）

## 结论
当前代码**部分对齐** Topology v3.0：Layer 2/3 主干已落地，Layer 4 已补齐可验证哈希链日志；仍有可提升项（Semantic Capability 的显式 vFD 抽象、更强回放快照统一化）。

## 分层验收

### Layer 2: Turing ISA/ABI（通过）
- 要求：只允许原子 syscall（SYS_WRITE/SYS_GOTO/SYS_EXEC/SYS_PUSH/SYS_POP/SYS_HALT）
- 证据：
  - `/home/zephryj/projects/turingos/src/kernel/types.ts`
  - `/home/zephryj/projects/turingos/src/oracle/universal-oracle.ts`
  - `/home/zephryj/projects/turingos/src/kernel/engine.ts`
- 验收结果：通过（非法 opcode 会触发 CPU_FAULT: INVALID_OPCODE）

### Layer 3: Microkernel（通过）
- 要求：同步 tick、HALT 验证门、死锁看门狗、Typed Paging
- 证据：
  - HALT gate / watchdog: `/home/zephryj/projects/turingos/src/kernel/engine.ts`
  - Typed Paging: `/home/zephryj/projects/turingos/src/manifold/local-manifold.ts`
- 验收结果：通过（存在 `[PAGE_TABLE_SUMMARY]` 与 `sys://page/<token>?p=<n>` 翻页）

### Layer 4: Infinite Tape + Append-only History（通过，已增强）
- 要求：外部观测切片可重放，历史附加单调且可验证
- 新增实现：`.journal.merkle.jsonl` 哈希链
- 证据：
  - 代码：`/home/zephryj/projects/turingos/src/chronos/file-chronos.ts`
  - 运行证据（smoke）：`/tmp/turingos-align-smoke-1772083446/.journal.merkle.jsonl`
- 验收结果：通过（每条记录含 `prev_hash` 和 `hash`，形成链）

## 回归命令
```bash
cd /home/zephryj/projects/turingos
npm run typecheck
npm run bench:os-longrun
```

## 当前性能状态（非架构状态）
- 最新长跑结果：`/home/zephryj/projects/turingos/benchmarks/results/os-longrun-20260226-044833.md`
- 结果：`passed=1/4`
- 说明：架构对齐与基准通过率是两条线；当前对齐推进已完成核心骨架，但行为策略仍需继续调优。
