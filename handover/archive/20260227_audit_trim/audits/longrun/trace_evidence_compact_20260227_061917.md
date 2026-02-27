# Trace Evidence Compact

- stamp: 20260227_061917
- source_trace: /home/zephryj/projects/turingos/benchmarks/audits/longrun/trace.jsonl
- source_report: /home/zephryj/projects/turingos/benchmarks/audits/longrun/voyager_realworld_eval_latest.json
- ticks: 120

## Evidence 1: VLIW Throughput (nQ + 1A, same tick)

- tick_seq: 1
- mind_ops: SYS_EDIT|SYS_PUSH
- world_op: SYS_EXEC

```json
{
  "tick_seq": 1,
  "d_t": "MAIN_TAPE.md",
  "d_next": "$ echo vliw_proof_2; grep -R \"import\" -n src | head -n 20",
  "mind_ops": [
    {
      "op": "SYS_EDIT",
      "task": "Prime VLIW proof frame for dual mind scheduling."
    },
    {
      "op": "SYS_PUSH",
      "task": "Capture explicit VLIW proof at tick 2."
    }
  ],
  "world_op": {
    "op": "SYS_EXEC",
    "cmd": "echo vliw_proof_2; grep -R \"import\" -n src | head -n 20"
  },
  "a_t": {
    "op": "SYS_EXEC",
    "cmd": "echo vliw_proof_2; grep -R \"import\" -n src | head -n 20"
  }
}
```

## Evidence 2: Chaos Flood Survival (50k log -> paging -> follow-up)

- flood_tick_seq: 2
- source_line: Source=command:echo vliw_proof_2; grep -R "import" -n src | head -n 20
- followup_tick_seq: 3
- followup_action: SYS_GOTO
- followup_pointer: sys://page/2b4463f2f02d1a2d?p=2

```json
{
  "flood": {
    "tick_seq": 2,
    "a_t": {
      "op": "SYS_GOTO",
      "pointer": "sys://page/2b4463f2f02d1a2d?p=2"
    },
    "world_op": {
      "op": "SYS_GOTO",
      "pointer": "sys://page/2b4463f2f02d1a2d?p=2"
    },
    "source_line": "Source=command:echo vliw_proof_2; grep -R \"import\" -n src | head -n 20"
  },
  "followup": {
    "tick_seq": 3,
    "d_t": "sys://page/2b4463f2f02d1a2d?p=2",
    "a_t": {
      "op": "SYS_GOTO",
      "pointer": "sys://page/2b4463f2f02d1a2d?p=3"
    },
    "world_op": {
      "op": "SYS_GOTO",
      "pointer": "sys://page/2b4463f2f02d1a2d?p=3"
    }
  }
}
```

## Evidence 3: O(1) Context ECG (>=100 ticks)

- min: 848
- max: 4096
- avg: 3977.33
- p95: 4096
- mmu_wall: 4096

```json
{
  "summary": {
    "min": 848,
    "max": 4096,
    "avg": 3977.33,
    "p95": 4096,
    "ticks": 120
  },
  "samples": [
    {
      "tick_seq": 0,
      "s_len": 848,
      "a_t": "SYS_GOTO",
      "world_op": "SYS_GOTO"
    },
    {
      "tick_seq": 20,
      "s_len": 4096,
      "a_t": "SYS_GOTO",
      "world_op": "SYS_GOTO"
    },
    {
      "tick_seq": 40,
      "s_len": 4096,
      "a_t": "SYS_GOTO",
      "world_op": "SYS_GOTO"
    },
    {
      "tick_seq": 60,
      "s_len": 4096,
      "a_t": "SYS_GOTO",
      "world_op": "SYS_GOTO"
    },
    {
      "tick_seq": 80,
      "s_len": 4096,
      "a_t": "SYS_GOTO",
      "world_op": "SYS_GOTO"
    },
    {
      "tick_seq": 100,
      "s_len": 4096,
      "a_t": "SYS_GOTO",
      "world_op": "SYS_GOTO"
    },
    {
      "tick_seq": 119,
      "s_len": 4096,
      "a_t": "SYS_GOTO",
      "world_op": "SYS_GOTO"
    }
  ]
}
```
