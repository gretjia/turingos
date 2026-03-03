import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import * as fs from 'node:fs';
import { IChronos, IPhysicalManifold, PCB, Pointer, ProcessState, Syscall, Transition } from './types.js';
import { HaltVerifier } from './halt-verifier.js';
import { DualBrainOracle } from '../oracle/dual-brain-oracle.js';

export interface HyperCoreRunOptions {
  maxTicks: number;
  onTick?: (tick: number, pid: string, q: string, d: string) => Promise<void> | void;
}

export interface HyperCoreRunResult {
  ticks: number;
  rootPid: string;
  rootState: ProcessState;
  q: string;
  d: string;
}

interface HyperCoreConfig {
  manifold: IPhysicalManifold;
  chronos: IChronos;
  oracle: DualBrainOracle;
  verifier: HaltVerifier;
  disciplinePrompt: string;
}

const MAX_RED_FLAGS = 3;
const MAX_THRASHING_STREAK = 3;
const MAX_NO_PHYSICAL_STREAK = 6;
const MAX_ROUTE_STALL_STREAK = 4;
const DEFAULT_MAX_REPEAT_WRITE_STREAK = 3;

export class TuringHyperCore {
  private readonly manifold: IPhysicalManifold;
  private readonly chronos: IChronos;
  private readonly oracle: DualBrainOracle;
  private readonly verifier: HaltVerifier;
  private readonly disciplinePrompt: string;
  private readonly plannerTemperature: number;
  private readonly workerTemperature: number;
  private readonly maxRepeatWriteStreak: number;
  private readonly mapReduceAheadByK: number;
  private readonly mapReduceMinVotes: number;
  private readonly filterFailedWorkerOutputs: boolean;
  private readonly forceMapTaskCount: number;
  private readonly plannerMapReduceDropWorldOp: boolean;
  private readonly singleMapPerProcess: boolean;
  private readonly autoWriteConsensusOnMapDrop: boolean;
  private readonly workerMapReducePolicy: 'kill' | 'drop';
  private readonly workerParallelism: number;
  private readonly strictIntegerWriteFiles: string[];
  private readonly strictIntegerWriteCoerce: boolean;
  private readonly strictIntegerWriteExtractLastInt: boolean;
  private readonly pcbTable = new Map<string, PCB>();
  private readonly readyQueue: string[] = [];
  private tickSeq = 0;

  constructor(config: HyperCoreConfig) {
    this.manifold = config.manifold;
    this.chronos = config.chronos;
    this.oracle = config.oracle;
    this.verifier = config.verifier;
    this.disciplinePrompt = config.disciplinePrompt;
    this.plannerTemperature = this.resolveTemperatureEnv('TURINGOS_HYPERCORE_PLANNER_TEMPERATURE', 0.7);
    this.workerTemperature = this.resolveTemperatureEnv('TURINGOS_HYPERCORE_WORKER_TEMPERATURE', 0.0);
    this.maxRepeatWriteStreak = this.resolvePositiveIntEnv(
      'TURINGOS_HYPERCORE_MAX_REPEAT_WRITE_STREAK',
      DEFAULT_MAX_REPEAT_WRITE_STREAK
    );
    this.mapReduceAheadByK = this.resolvePositiveIntEnv('TURINGOS_HYPERCORE_AHEAD_BY_K', 1);
    this.mapReduceMinVotes = this.resolvePositiveIntEnv('TURINGOS_HYPERCORE_REDUCE_MIN_VOTES', 2);
    this.filterFailedWorkerOutputs = this.resolveBoolEnv('TURINGOS_HYPERCORE_FILTER_FAILED_WORKERS', true);
    this.forceMapTaskCount = this.resolvePositiveIntEnv('TURINGOS_HYPERCORE_FORCE_MAP_TASK_COUNT', 0);
    this.plannerMapReduceDropWorldOp = this.resolveBoolEnv('TURINGOS_HYPERCORE_PLANNER_MAP_REDUCE_DROP_WORLD_OP', false);
    this.singleMapPerProcess = this.resolveBoolEnv('TURINGOS_HYPERCORE_SINGLE_MAP_PER_PROCESS', false);
    this.autoWriteConsensusOnMapDrop = this.resolveBoolEnv(
      'TURINGOS_HYPERCORE_AUTO_WRITE_CONSENSUS_ON_MAP_DROP',
      false
    );
    this.workerMapReducePolicy = this.resolveWorkerMapReducePolicyEnv('TURINGOS_HYPERCORE_WORKER_MAP_REDUCE_POLICY', 'kill');
    this.workerParallelism = this.resolvePositiveIntEnv('TURINGOS_HYPERCORE_WORKER_PARALLELISM', 1);
    this.strictIntegerWriteFiles = this.resolveCsvEnv('TURINGOS_HYPERCORE_STRICT_INTEGER_WRITE_FILES');
    this.strictIntegerWriteCoerce = this.resolveBoolEnv('TURINGOS_HYPERCORE_STRICT_INTEGER_WRITE_COERCE', true);
    this.strictIntegerWriteExtractLastInt = this.resolveBoolEnv(
      'TURINGOS_HYPERCORE_STRICT_INTEGER_WRITE_EXTRACT_LAST_INT',
      true
    );
  }

  public spawnRoot(initialQ: string, initialD: string): string {
    const pid = this.spawn('PLANNER', initialQ, null, initialQ, initialD);
    return pid;
  }

  public spawn(
    role: 'PLANNER' | 'WORKER',
    task: string,
    ppid: string | null,
    initialQ: string,
    initialD: string
  ): string {
    const pid = `${role.toLowerCase()}_${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    let finalTemperature = role === 'PLANNER' ? this.plannerTemperature : this.workerTemperature;
    
    // Introduce Temperature Dithering for Swarm Entropy (K-workers)
    // If it's a WORKER and we have baseline dithering enabled via env (or fallback logic).
    // DeepThink requested dithering from T=0.1 to T=0.7 across 16 Windows workers based on ID.
    if (role === 'WORKER') {
       // Calculate deterministic temperature based on PID hash to ensure even spread.
       let hash = 0;
       for (let i = 0; i < pid.length; i++) {
         hash = (hash << 5) - hash + pid.charCodeAt(i);
         hash |= 0;
       }
       const kIndex = Math.abs(hash) % 16;
       // Map kIndex (0-15) linearly to range 0.1 - 0.7
       finalTemperature = Number((0.1 + (0.6 * (kIndex / 15.0))).toFixed(3));
    }

    const pcb: PCB = {
      pid,
      ppid,
      state: 'READY',
      role,
      temperature: role === 'PLANNER' ? this.plannerTemperature : this.workerTemperature,
      price: 0,
      redFlags: 0,
      chronos: [{ ts: now, role: 'system', content: `[TASK] ${task}` }],
      registers: {
        q: initialQ,
        d: initialD,
        mindOnlyStreak: 0,
        noPhysicalStreak: 0,
        routeStallStreak: 0,
        lastRouteFingerprint: '',
      },
      waitPids: new Set<string>(),
      mailbox: [],
      workspaceHashes: [],
    };
    this.pcbTable.set(pid, pcb);
    this.readyQueue.push(pid);
    return pid;
  }

  public async run(rootPid: string, options: HyperCoreRunOptions): Promise<HyperCoreRunResult> {
    while (this.tickSeq < options.maxTicks && !this.isTerminal(rootPid)) {
      await this.topWhiteBoxPricingLoop();

      const remainingTickBudget = options.maxTicks - this.tickSeq;
      if (remainingTickBudget <= 0) {
        break;
      }
      const batch = this.dequeueReadyBatch(remainingTickBudget);
      if (batch.length === 0) {
        if (!this.hasInFlightWork()) {
          break;
        }
        await sleep(20);
        continue;
      }
      await Promise.all(batch.map((pid) => this.executeOneReadyProcess(pid, options.onTick)));
    }

    // Settle a HALT request emitted on the final allowed tick.
    await this.topWhiteBoxPricingLoop();

    const root = this.pcbTable.get(rootPid);
    return {
      ticks: this.tickSeq,
      rootPid,
      rootState: root?.state ?? 'KILLED',
      q: root ? this.readRegisterString(root, 'q') : 'HALT',
      d: root ? this.readRegisterString(root, 'd') : 'HALT',
    };
  }

  private async applyTransition(pcb: PCB, transition: Transition): Promise<void> {
    const qBefore = this.readRegisterString(pcb, 'q');
    const dBefore = this.readRegisterString(pcb, 'd');
    const qNext = typeof transition.q_next === 'string' && transition.q_next.trim().length > 0
      ? transition.q_next
      : this.readRegisterString(pcb, 'q');

    let mindOps = transition.mind_ops ?? [];
    const worldOps = transition.world_ops
      ? [...transition.world_ops]
      : transition.world_op
        ? [transition.world_op]
        : [];

    if (mindOps.length === 0 && worldOps.length === 0) {
      throw new Error('INVALID_FRAME: transition must include mind_ops and/or world_op in anti-oreo v2 mode.');
    }

    let normalizedWorldOps = worldOps.filter((op): op is Syscall => Boolean(op));
    if (normalizedWorldOps.length > 1) {
      throw new Error(`CAUSALITY_VIOLATION_MULTIPLE_WORLD_OPS:${normalizedWorldOps.map((op) => op.op).join(',')}`);
    }

    let hasMapReduce = mindOps.some((op) => op.op === 'SYS_MAP_REDUCE');
    if (hasMapReduce && pcb.role !== 'PLANNER') {
      if (this.workerMapReducePolicy === 'drop') {
        await this.chronos.engrave(`[HYPERCORE_TRAP] pid=${pcb.pid} details=WORKER_MAP_REDUCE_DROPPED`);
        mindOps = mindOps.filter((op) => op.op !== 'SYS_MAP_REDUCE');
        hasMapReduce = mindOps.some((op) => op.op === 'SYS_MAP_REDUCE');
        if (mindOps.length === 0 && normalizedWorldOps.length === 0) {
          pcb.state = 'KILLED';
          pcb.price -= 1;
          if (pcb.ppid) {
            await this.resolveJoin(pcb.ppid, pcb.pid, '[RED_FLAG] WORKER_MAP_REDUCE_FORBIDDEN');
          }
          return;
        }
      } else {
        pcb.state = 'KILLED';
        pcb.price -= 1;
        await this.chronos.engrave(`[HYPERCORE_TRAP] pid=${pcb.pid} details=WORKER_MAP_REDUCE_FORBIDDEN`);
        if (pcb.ppid) {
          await this.resolveJoin(pcb.ppid, pcb.pid, '[RED_FLAG] WORKER_MAP_REDUCE_FORBIDDEN');
        }
        return;
      }
    }
    if (hasMapReduce && pcb.role === 'PLANNER' && this.singleMapPerProcess) {
      const joinsSeen = this.readRegisterNumber(pcb, 'mapReduceJoinCount');
      if (joinsSeen > 0) {
        mindOps = mindOps.filter((op) => op.op !== 'SYS_MAP_REDUCE');
        hasMapReduce = mindOps.some((op) => op.op === 'SYS_MAP_REDUCE');
        await this.chronos.engrave(
          `[HYPERCORE_TRAP] pid=${pcb.pid} details=PLANNER_MAP_REDUCE_DROPPED_AFTER_JOIN_KEEP_WORLD`
        );
        if (this.autoWriteConsensusOnMapDrop && normalizedWorldOps.length === 0) {
          const lastConsensus = this.readRegisterString(pcb, 'lastMapReduceConsensus').trim();
          if (/^-?[0-9]+$/.test(lastConsensus)) {
            await this.executeWorldOp(pcb, {
              op: 'SYS_WRITE',
              payload: `${lastConsensus}\n`,
              semantic_cap: 'ANSWER.txt',
            });
            const q = this.readRegisterString(pcb, 'q');
            this.writeRegisterString(
              pcb,
              'q',
              `${q}\n[MAP_REDUCE_SKIPPED_AFTER_JOIN] auto_write_consensus=${lastConsensus}`
            );
            await this.chronos.engrave(
              `[HYPERCORE_AUTOWRITE] pid=${pcb.pid} source=join_consensus consensus=${lastConsensus}`
            );
            
            // Force halt to prevent recursive auto-write loops. 
            pcb.state = 'PENDING_HALT';
            pcb.exitOutput = this.readRegisterString(pcb, 'q');
            await this.chronos.engrave(`[HYPERCORE_HALT_REQUEST] pid=${pcb.pid} details=AUTO_WRITE_HALT`);
          } else if (lastConsensus && !/^-?[0-9]+$/.test(lastConsensus)) {
            const q = this.readRegisterString(pcb, 'q');
            this.writeRegisterString(
              pcb,
              'q',
              `${q}\n[SYSTEM RED FLAG] The worker swarm failed to reach a numeric consensus. Returned: ${lastConsensus}. Do NOT attempt to calculate the answer in-weights and do NOT transcribe numbers directly. You MUST emit SYS_EXEC_PYTHON containing a Python script that opens MAIN_TAPE.md, parses the numbers via string splitting, and calculates the exact numerical answer. Await the system's [SYS_EXEC_RESULT] response before doing anything else.`
            );
          }
        }
      }
    }
    if (hasMapReduce && normalizedWorldOps.length > 0) {
      if (pcb.role === 'PLANNER' && this.plannerMapReduceDropWorldOp) {
        await this.chronos.engrave(
          `[HYPERCORE_TRAP] pid=${pcb.pid} details=PLANNER_MAP_REDUCE_DROPPED_WORLD_OP world_op=${normalizedWorldOps[0]?.op ?? 'unknown'}`
        );
        normalizedWorldOps = [];
      } else {
        throw new Error('CAUSALITY_VIOLATION: SYS_MAP_REDUCE cannot be combined with world_op in the same tick.');
      }
    }

    this.writeRegisterString(pcb, 'q', qNext);
    for (const op of mindOps) {
      await this.executeMindOp(pcb, op);
      if (pcb.state !== 'RUNNING') {
        break;
      }
    }

    const worldOp = normalizedWorldOps[0] ?? null;
    if (pcb.state === 'RUNNING' && worldOp) {
      await this.executeWorldOp(pcb, worldOp);
      if (worldOp.op === 'SYS_WRITE') {
        await this.evaluateWriteThrashingAfterWrite(pcb, worldOp, dBefore);
      } else {
        this.writeRegisterString(pcb, 'lastWriteSignature', '');
        this.writeRegisterNumber(pcb, 'writeRepeatStreak', 0);
      }
    }

    const mindOnly = mindOps.length > 0 && !worldOp;
    const streak = Number(this.readRegisterNumber(pcb, 'mindOnlyStreak'));
    const nextStreak = mindOnly ? streak + 1 : 0;
    this.writeRegisterNumber(pcb, 'mindOnlyStreak', nextStreak);
    if (nextStreak >= MAX_THRASHING_STREAK) {
      throw new Error(`TRAP_THRASHING: ${MAX_THRASHING_STREAK} consecutive mind-only ticks`);
    }

    const worldOpName = worldOp?.op ?? '';
    const hasPhysicalWorldOp = worldOpName === 'SYS_WRITE' || worldOpName === 'SYS_EXEC' || worldOpName === 'SYS_EXEC_PYTHON' || worldOpName === 'SYS_HALT';
    const noPhysicalStreak = hasPhysicalWorldOp
      ? 0
      : this.readRegisterNumber(pcb, 'noPhysicalStreak') + 1;
    this.writeRegisterNumber(pcb, 'noPhysicalStreak', noPhysicalStreak);
    if (
      noPhysicalStreak >= MAX_NO_PHYSICAL_STREAK &&
      (pcb.state === 'RUNNING' || pcb.state === 'READY')
    ) {
      throw new Error(`TRAP_THRASHING_NO_PHYSICAL_IO: ${MAX_NO_PHYSICAL_STREAK} ticks without SYS_WRITE/SYS_EXEC/SYS_HALT`);
    }

    const dAfter = this.readRegisterString(pcb, 'd');
    const routeFingerprint = this.composeRouteFingerprint(pcb, mindOps, worldOpName, qBefore, dBefore, dAfter);
    const lastRouteFingerprint = this.readRegisterString(pcb, 'lastRouteFingerprint');
    const routeStallStreak = routeFingerprint === lastRouteFingerprint
      ? this.readRegisterNumber(pcb, 'routeStallStreak') + 1
      : 1;
    this.writeRegisterString(pcb, 'lastRouteFingerprint', routeFingerprint);
    this.writeRegisterNumber(pcb, 'routeStallStreak', routeStallStreak);
    if (
      routeStallStreak >= MAX_ROUTE_STALL_STREAK &&
      !hasPhysicalWorldOp &&
      (pcb.state === 'RUNNING' || pcb.state === 'READY')
    ) {
      throw new Error(`TRAP_ROUTE_THRASHING: repeated route fingerprint ${routeStallStreak}x (${routeFingerprint})`);
    }

    if (pcb.state === 'RUNNING') {
      this.schedule(pcb);
    }
  }

  private async executeMindOp(pcb: PCB, op: Syscall): Promise<void> {
    switch (op.op) {
      case 'SYS_PUSH':
        await this.manifold.interfere('sys://callstack', `PUSH: ${op.task}`);
        return;
      case 'SYS_EDIT':
        await this.manifold.interfere('sys://callstack', `EDIT: ${op.task}`);
        return;
      case 'SYS_MOVE': {
        const parts: string[] = [];
        if (typeof op.task_id === 'string' && op.task_id.trim().length > 0) {
          parts.push(`task_id=${op.task_id.trim()}`);
        }
        if (typeof op.target_pos === 'string' && op.target_pos.trim().length > 0) {
          parts.push(`target_pos=${op.target_pos.trim().toUpperCase()}`);
        }
        if (typeof op.status === 'string' && op.status.trim().length > 0) {
          parts.push(`status=${op.status.trim().toUpperCase()}`);
        }
        await this.manifold.interfere('sys://callstack', `MOVE: ${parts.join('; ') || 'target_pos=BOTTOM'}`);
        return;
      }
      case 'SYS_POP':
        await this.manifold.interfere('sys://callstack', 'POP');
        return;
      case 'SYS_MAP_REDUCE': {
        if (pcb.role !== 'PLANNER') {
          pcb.state = 'KILLED';
          pcb.price -= 1;
          await this.chronos.engrave(`[HYPERCORE_TRAP] pid=${pcb.pid} details=WORKER_MAP_REDUCE_FORBIDDEN`);
          if (pcb.ppid) {
            await this.resolveJoin(pcb.ppid, pcb.pid, '[RED_FLAG] WORKER_MAP_REDUCE_FORBIDDEN');
          }
          return;
        }
        let tasks = op.tasks
          .map((task) => task.trim())
          .filter((task) => task.length > 0);
        if (tasks.length === 0) {
          throw new Error('SYS_MAP_REDUCE requires non-empty tasks array.');
        }
        const joinsSeen = this.readRegisterNumber(pcb, 'mapReduceJoinCount');
        if (this.singleMapPerProcess && joinsSeen > 0) {
          const q = this.readRegisterString(pcb, 'q');
          this.writeRegisterString(
            pcb,
            'q',
            `${q}\n[MAP_REDUCE_SKIPPED_AFTER_JOIN] reuse consensus and continue with SYS_WRITE/SYS_HALT flow.`
          );
          await this.chronos.engrave(`[HYPERCORE_TRAP] pid=${pcb.pid} details=PLANNER_MAP_REDUCE_SKIPPED_AFTER_JOIN`);
          return;
        }
        if (this.forceMapTaskCount > 0) {
          const targetCount = this.forceMapTaskCount;
          if (tasks.length > targetCount) {
            tasks = tasks.slice(0, targetCount);
          } else if (tasks.length < targetCount) {
            const template = tasks[0];
            while (tasks.length < targetCount) {
              tasks.push(template);
            }
          }
        }
        const parentQ = this.readRegisterString(pcb, 'q');
        const parentD = this.readRegisterString(pcb, 'd');
        this.writeRegisterNumber(pcb, 'mapReduceTotalSpawned', tasks.length);
        tasks.forEach((task, index) => {
          const childQ = [
            'q_worker_boot:',
            'ROLE=WORKER',
            'Hard constraint: NEVER emit SYS_MAP_REDUCE.',
            'Solve task deterministically and return only integer result.',
            'Final q_next must include one line: RESULT:<integer>.',
            `TASK: ${task}`,
          ].join('\n');
          const childPid = this.spawn('WORKER', task, pcb.pid, childQ, parentD);
          const childPcb = this.pcbTable.get(childPid);
          if (childPcb) {
            const ditheredTemp = Math.max(0.0, Math.min(1.0, 0.7 + ((index - 8) * 0.025)));
            childPcb.temperature = ditheredTemp;
          }
          pcb.waitPids.add(childPid);
        });
        pcb.state = 'BLOCKED';
        await this.chronos.engrave(
          `[HYPERCORE_MAP] pid=${pcb.pid} children=${Array.from(pcb.waitPids).join(',')} task_count=${tasks.length}`
        );
        this.writeRegisterString(pcb, 'q', `${parentQ}\n[MAP_REDUCE] spawned=${tasks.length}`);
        return;
      }
      default:
        return;
    }
  }

  private async executeWorldOp(pcb: PCB, op: Syscall): Promise<void> {
    const currentD = this.readRegisterString(pcb, 'd');
    switch (op.op) {
      case 'SYS_WRITE': {
        const targetPointer = typeof op.semantic_cap === 'string' && op.semantic_cap.trim().length > 0
          ? op.semantic_cap.trim()
          : currentD;
        const normalized = this.normalizeStrictIntegerPayload(targetPointer, op.payload);
        op.payload = normalized.payload;
        if (normalized.coerced) {
          await this.chronos.engrave(
            `[HYPERCORE_STRICT_WRITE_COERCE] pid=${pcb.pid} pointer=${targetPointer} source=${normalized.reason}`
          );
        }
        await this.manifold.interfere(targetPointer, op.payload);
        this.writeRegisterString(pcb, 'd', currentD);
        return;
      }
      case 'SYS_EXEC': {
        const cmd = op.cmd.trim();
        
        // If the LLM falls back to SYS_EXEC instead of SYS_EXEC_PYTHON but tries to write python inline
        if (cmd.startsWith('with open(') || cmd.startsWith('import ') || cmd.includes('print(int(expr')) {
           return this.executeWorldOp(pcb, { op: 'SYS_EXEC_PYTHON', code: cmd });
        }

        const nextD = cmd.startsWith('$') ? cmd : `$ ${cmd}`;
        this.writeRegisterString(pcb, 'd', nextD);
        return;
      }
      case 'SYS_EXEC_PYTHON': {
        const workspaceDir = (this.manifold as any).workspaceDir || process.cwd();
        const tempFile = path.join(workspaceDir, `script_${pcb.pid}.py`);
        
        console.log(`\n\n[!!!] WORKER GENERATED PYTHON CODE [!!!]\nPID: ${pcb.pid}\nCODE:\n${op.code}\n`);

        let result = '';
        if (!op.code.includes('MAIN_TAPE.md') || !op.code.includes('open')) {
            result = '[PYTHON_EXEC_ERROR]\nFATAL_SYSTEM_DIRECTIVE_VIOLATION: You did not open MAIN_TAPE.md. You MUST dynamically read the tape using file I/O.';
        } else if (/\d{2,}/.test(op.code) || /['"]\d+['"]/.test(op.code)) {
            result = '[PYTHON_EXEC_ERROR]\nFATAL_SYSTEM_DIRECTIVE_VIOLATION: Hardcoded numbers or number-strings detected. You MUST dynamically extract values via MAIN_TAPE.md using split().';
        } else {
            fs.writeFileSync(tempFile, op.code);
            try {
               result = execSync(`python3 ${tempFile}`, { cwd: workspaceDir, timeout: 5000, encoding: 'utf-8' }).trim();
            } catch(e: any) {
               const errOut = (e.stderr || e.message || '').toString().trim();
               result = `[PYTHON_EXEC_ERROR]\n${errOut}`;
            }
        }
        
        if (pcb.role === 'WORKER') {
           this.writeRegisterNumber(pcb, 'hasUsedALU', 1);
           pcb.exitOutput = `RESULT: ${result}\nCODE: ${op.code}`;
           pcb.state = 'PENDING_HALT';
           await this.chronos.engrave(`[PYTHON_EXEC_CODE] worker=${pcb.pid} code=${op.code.replace(/\\n/g, ' ')}`);
        } else {
           this.writeRegisterString(pcb, 'q', `${this.readRegisterString(pcb, 'q')}\n[SYS_EXEC_PYTHON_CODE]\n${op.code}\n[SYS_EXEC_RESULT: ${result}]`);
        }
        return;
      }
      case 'SYS_GOTO':
        this.writeRegisterString(pcb, 'd', op.pointer);
        return;
      case 'SYS_GIT_LOG':
        this.writeRegisterString(pcb, 'd', this.composeGitLogPointer(op));
        return;
      case 'SYS_HALT':
        if (pcb.role === 'WORKER') {
           const hasUsedALU = this.readRegisterNumber(pcb, 'hasUsedALU');
           if (hasUsedALU === 0) {
              const q = this.readRegisterString(pcb, 'q');
              this.writeRegisterString(pcb, 'q', `${q}\n[SYSTEM ERROR] You CANNOT call SYS_HALT directly. You MUST emit SYS_EXEC_PYTHON to evaluate the math. Your neural weights are lossy.`);
              return;
           }
        }

        pcb.exitOutput = this.readRegisterString(pcb, 'q');
        pcb.state = 'PENDING_HALT';
        await this.chronos.engrave(`[HYPERCORE_HALT_REQUEST] pid=${pcb.pid}`);
        return;
      default:
        return;
    }
  }

  private composeGitLogPointer(op: Extract<Syscall, { op: 'SYS_GIT_LOG' }>): Pointer {
    const params = new URLSearchParams();
    const add = (key: string, value: unknown): void => {
      if (typeof value !== 'string') {
        return;
      }
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        params.set(key, trimmed);
      }
    };
    if (typeof op.limit === 'number' && Number.isFinite(op.limit) && op.limit > 0) {
      params.set('limit', String(Math.floor(op.limit)));
    }
    add('path', op.path);
    add('ref', op.ref);
    add('grep', op.grep);
    add('since', op.since);
    add('query_params', op.query_params);
    const query = params.toString();
    return query.length > 0 ? `sys://git/log?${query}` : 'sys://git/log';
  }

  private async topWhiteBoxPricingLoop(): Promise<void> {
    for (const pcb of this.pcbTable.values()) {
      if (pcb.state !== 'PENDING_HALT') {
        continue;
      }
      if (pcb.role === 'WORKER') {
        pcb.state = 'TERMINATED';
        pcb.price += 1;
        await this.chronos.engrave(`[HYPERCORE_PRICE] pid=${pcb.pid} verdict=WORKER_ACCEPT price=${pcb.price}`);
        if (pcb.ppid) {
          await this.resolveJoin(pcb.ppid, pcb.pid, pcb.exitOutput ?? '[HALT_WORKER]');
        }
        continue;
      }
      const result = this.verifier.verify();
      if (result.passed) {
        pcb.state = 'TERMINATED';
        pcb.price += 1;
        await this.chronos.engrave(`[HYPERCORE_PRICE] pid=${pcb.pid} verdict=PASS price=${pcb.price}`);
        if (pcb.ppid) {
          await this.resolveJoin(pcb.ppid, pcb.pid, pcb.exitOutput ?? '[HALT_PASS]');
        }
      } else {
        // KILL_AND_FAIL logic: If Planner fails multiple times (e.g. price drops below -3)
        // kill it to fail the test run rather than looping infinitely on a wrong answer.
        if (pcb.price <= -3) {
            pcb.state = 'KILLED';
            this.writeRegisterString(pcb, 'q', `${this.readRegisterString(pcb, 'q')}\n[KILLED] Exceeded maximum verification rejections. Consensus or self-calculated answer was persistently incorrect.`);
            await this.chronos.engrave(`[HYPERCORE_PRICE] pid=${pcb.pid} verdict=FAIL price=${pcb.price} status=KILLED`);
            continue;
        }

        pcb.price -= 1;
        pcb.state = 'READY';
        const q = this.readRegisterString(pcb, 'q');
        let consensusFeedback = '';
        const lastConsensus = this.readRegisterString(pcb, 'lastMapReduceConsensus').trim();
        if (lastConsensus && /^-?[0-9]+$/.test(lastConsensus)) {
          consensusFeedback = `\n[SYSTEM RED FLAG] The consensus answer ${lastConsensus} is INCORRECT. DO NOT submit this number again.`;
        }

        this.writeRegisterString(
          pcb,
          'q',
          `${q}\n[WHITE_BOX_REJECTED]\ncommand=${result.command}\nexit=${result.exitCode}\n${result.feedback}${consensusFeedback}`
        );
        this.readyQueue.push(pcb.pid);
        await this.chronos.engrave(`[HYPERCORE_PRICE] pid=${pcb.pid} verdict=FAIL price=${pcb.price}`);
      }
    }
  }

  private async resolveJoin(ppid: string, childPid: string, output: string): Promise<void> {
    const parent = this.pcbTable.get(ppid);
    if (!parent) {
      return;
    }
    parent.waitPids.delete(childPid);
    const redFlagged = this.isWorkerOutputRedFlag(output);
    if (redFlagged && this.filterFailedWorkerOutputs) {
      await this.chronos.engrave(`[HYPERCORE_REDUCE_DROP] pid=${parent.pid} child=${childPid} reason=red_flag`);
    } else {
      const voteToken = this.extractWorkerVoteToken(output);
      if (voteToken !== null) {
        parent.mailbox.push(voteToken);
      } else {
        await this.chronos.engrave(`[HYPERCORE_REDUCE_DROP] pid=${parent.pid} child=${childPid} reason=invalid_vote_format`);
      }
    }

    if (parent.state !== 'BLOCKED') {
      return;
    }

    const tally = this.tallyVotes(parent.mailbox);
    const best = tally[0] ?? null;
    const runnerUp = tally[1] ?? null;
    const bestVotes = best?.count ?? 0;
    const runnerUpVotes = runnerUp?.count ?? 0;
    const thresholdAheadByK =
      parent.mailbox.length >= this.mapReduceMinVotes &&
      bestVotes >= runnerUpVotes + this.mapReduceAheadByK;
    const remainingChildren = parent.waitPids.size;
    const mathematicallyLocked = bestVotes > runnerUpVotes + remainingChildren;
    
    // P85 Quorum barrier
    const totalSpawned = this.readRegisterNumber(parent, 'mapReduceTotalSpawned');
    const quorumThreshold = Math.ceil((totalSpawned || 1) * 0.85);
    const p85Reached = parent.mailbox.length >= quorumThreshold;

    const decisiveEarlyStop = thresholdAheadByK || mathematicallyLocked || p85Reached;
    const allChildrenDone = parent.waitPids.size === 0;
    if (!decisiveEarlyStop && !allChildrenDone) {
      return;
    }

    if (decisiveEarlyStop && parent.waitPids.size > 0) {
      for (const pendingPid of Array.from(parent.waitPids)) {
        const pending = this.pcbTable.get(pendingPid);
        if (pending && (pending.state === 'READY' || pending.state === 'RUNNING' || pending.state === 'BLOCKED')) {
          pending.state = 'KILLED';
        }
        parent.waitPids.delete(pendingPid);
      }
    }

    const consensus = best?.token ?? '[NO_VALID_VOTE]';
    const q = this.readRegisterString(parent, 'q');
    this.writeRegisterString(
      parent,
      'q',
      `${q}\n[MAP_REDUCE_JOIN]\nconsensus=${consensus}\nbest_votes=${bestVotes}\nrunner_up_votes=${runnerUpVotes}\nahead_by_k=${this.mapReduceAheadByK}\ncollected=${parent.mailbox.length}`
    );
    this.writeRegisterString(parent, 'lastMapReduceConsensus', consensus);
    const joinsSeen = this.readRegisterNumber(parent, 'mapReduceJoinCount');
    this.writeRegisterNumber(parent, 'mapReduceJoinCount', joinsSeen + 1);
    parent.mailbox = [];
    this.schedule(parent);
    await this.chronos.engrave(
      `[HYPERCORE_REDUCE] pid=${parent.pid} resumed=1 early_stop=${decisiveEarlyStop ? 1 : 0} math_lock=${mathematicallyLocked ? 1 : 0} consensus=${consensus} votes=${bestVotes}/${runnerUpVotes}`
    );
  }

  private async handleRedFlag(pcb: PCB, details: string): Promise<void> {
    const redFlag = this.isRedFlaggableFault(details);
    if (redFlag) {
      pcb.redFlags += 1;
      await this.chronos.engrave(
        `[HYPERCORE_RED_FLAG] pid=${pcb.pid} red_flags=${pcb.redFlags}/${MAX_RED_FLAGS} details=${details}`
      );
    } else {
      await this.chronos.engrave(`[HYPERCORE_TRAP] pid=${pcb.pid} details=${details}`);
    }

    if (pcb.redFlags >= MAX_RED_FLAGS) {
      pcb.state = 'KILLED';
      pcb.price -= 10;
      this.writeRegisterString(pcb, 'q', `${this.readRegisterString(pcb, 'q')}\n[KILLED] ${details}`);
      if (pcb.ppid) {
        await this.resolveJoin(pcb.ppid, pcb.pid, `[FAILED DUE TO RED FLAGS] ${details}`);
      }
      return;
    }

    const q = this.readRegisterString(pcb, 'q');
    this.writeRegisterString(pcb, 'q', `${q}\n[SYS_ERROR] ${details}`);
    this.schedule(pcb);
  }

  private schedule(pcb: PCB): void {
    if (pcb.state === 'TERMINATED' || pcb.state === 'KILLED') {
      return;
    }
    pcb.state = 'READY';
    this.readyQueue.push(pcb.pid);
  }

  private async executeOneReadyProcess(
    pid: string,
    onTick?: (tick: number, pid: string, q: string, d: string) => Promise<void> | void
  ): Promise<void> {
    const pcb = this.pcbTable.get(pid);
    if (!pcb || pcb.state !== 'READY') {
      return;
    }
    pcb.state = 'RUNNING';

    const q = this.readRegisterString(pcb, 'q');
    const d = this.readRegisterString(pcb, 'd');
    const s = await this.observeWithTrap(d);

    let transition: Transition;
    try {
      transition = await this.oracle.dispatchTick(pcb, this.disciplinePrompt, q, s);
      const routeTrace = this.oracle.consumeLastTrace(pcb.pid);
      if (routeTrace) {
        await this.chronos.engrave(`[HYPERCORE_ROUTE] ${JSON.stringify(routeTrace)}`);
      }
    } catch (error: unknown) {
      await this.handleRedFlag(pcb, this.renderError(error));
      return;
    }

    let microSnapshotPath = '';
    const hasWorldOp = transition.world_ops && transition.world_ops.length > 0 || transition.world_op;
    const workspaceDir = this.manifold instanceof Object && 'workspaceDir' in this.manifold ? (this.manifold as any).workspaceDir : null;

    if (workspaceDir) {
      const currentHash = this.computeWorkspaceHash(workspaceDir as string);
      if (currentHash && pcb.workspaceHashes.includes(currentHash)) {
        await this.handleRedFlag(pcb, 'CAUSALITY_VIOLATION: PERIOD_N_SEMANTIC_COLLAPSE (Recursive loop detected via Workspace Merkle Tree)');
        pcb.temperature = 1.0;
      }
      if (currentHash) {
        pcb.workspaceHashes.push(currentHash);
        if (pcb.workspaceHashes.length > 50) pcb.workspaceHashes.shift();
      }
    }

    if (hasWorldOp && workspaceDir) {
      microSnapshotPath = path.join(workspaceDir as string, '.micro_snapshot.tmp');
      try {
        execSync(`rm -rf ${microSnapshotPath} && mkdir -p ${microSnapshotPath} && cp -a * ${microSnapshotPath} 2>/dev/null || true`, { cwd: workspaceDir as string });
      } catch {
        // Ignore error
      }
    }

    try {
      await this.applyTransition(pcb, transition);
      if (hasWorldOp && microSnapshotPath && workspaceDir) {
        try {
          execSync(`rm -rf ${microSnapshotPath}`, { cwd: workspaceDir as string });
        } catch {
           // Ignore error
        }
      }
    } catch (error: unknown) {
      if (hasWorldOp && microSnapshotPath && workspaceDir) {
        try {
          execSync(`cp -a ${microSnapshotPath}/* . 2>/dev/null || true && rm -rf ${microSnapshotPath}`, { cwd: workspaceDir as string });
        } catch {
           // Ignore error
        }
      }
      await this.handleRedFlag(pcb, this.renderError(error));
    }

    const tick = this.bumpTick();
    const latestQ = this.readRegisterString(pcb, 'q');
    const latestD = this.readRegisterString(pcb, 'd');
    if (onTick) {
      await onTick(tick, pcb.pid, latestQ, latestD);
    }
  }

  private bumpTick(): number {
    this.tickSeq += 1;
    return this.tickSeq;
  }

  private dequeueReadyBatch(maxItems: number): string[] {
    const boundedMaxItems = Math.max(1, maxItems);
    const plannerPid = this.extractReadyByRole('PLANNER', 1);
    if (plannerPid.length > 0) {
      return plannerPid;
    }
    const workerLimit = Math.min(boundedMaxItems, Math.max(1, this.workerParallelism));
    return this.extractReadyByRole('WORKER', workerLimit);
  }

  private extractReadyByRole(role: 'PLANNER' | 'WORKER', limit: number): string[] {
    if (limit <= 0) {
      return [];
    }
    const selected: string[] = [];
    const remaining: string[] = [];
    while (this.readyQueue.length > 0) {
      const pid = this.readyQueue.shift()!;
      const pcb = this.pcbTable.get(pid);
      if (!pcb || pcb.state !== 'READY') {
        continue;
      }
      if (selected.length < limit && pcb.role === role) {
        selected.push(pid);
        continue;
      }
      remaining.push(pid);
    }
    this.readyQueue.push(...remaining);
    return selected;
  }

  private hasInFlightWork(): boolean {
    for (const pcb of this.pcbTable.values()) {
      if (pcb.state === 'BLOCKED' || pcb.state === 'PENDING_HALT' || pcb.state === 'READY' || pcb.state === 'RUNNING') {
        return true;
      }
    }
    return false;
  }

  private isTerminal(pid: string): boolean {
    const pcb = this.pcbTable.get(pid);
    if (!pcb) {
      return true;
    }
    return pcb.state === 'TERMINATED' || pcb.state === 'KILLED';
  }

  private async observeWithTrap(pointer: string): Promise<string> {
    try {
      return await this.manifold.observe(pointer);
    } catch (error: unknown) {
      return `[OS_TRAP: PAGE_FAULT] ${this.renderError(error)}`;
    }
  }

  private renderError(error: unknown): string {
    if (error instanceof Error) {
      return `${error.name}: ${error.message}`;
    }
    return String(error);
  }

  private readRegisterString(pcb: PCB, key: string): string {
    const value = pcb.registers[key];
    return typeof value === 'string' ? value : '';
  }

  private writeRegisterString(pcb: PCB, key: string, value: string): void {
    pcb.registers[key] = value;
  }

  private readRegisterNumber(pcb: PCB, key: string): number {
    const value = pcb.registers[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    return 0;
  }

  private writeRegisterNumber(pcb: PCB, key: string, value: number): void {
    pcb.registers[key] = value;
  }

  private composeRouteFingerprint(
    pcb: PCB,
    mindOps: Syscall[],
    worldOpName: string,
    qBefore: string,
    dBefore: string,
    dAfter: string
  ): string {
    const mindSignature = mindOps.map((op) => op.op).join(',');
    const qChanged = qBefore !== this.readRegisterString(pcb, 'q') ? '1' : '0';
    const dChanged = dBefore !== dAfter ? '1' : '0';
    return [
      `mind=${mindSignature || '-'}`,
      `world=${worldOpName || '-'}`,
      `state=${pcb.state}`,
      `wait=${pcb.waitPids.size}`,
      `q_changed=${qChanged}`,
      `d_changed=${dChanged}`,
      `d=${dAfter}`,
    ].join('|');
  }

  private isRedFlaggableFault(details: string): boolean {
    return (
      details.includes('INVALID_OPCODE') ||
      details.includes('MUTEX_VIOLATION') ||
      details.includes('CAUSALITY_VIOLATION') ||
      details.includes('TRAP_THRASHING_NO_PHYSICAL_IO') ||
      details.includes('EACCES')
    );
  }

  private resolveTemperatureEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) {
      return fallback;
    }
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    if (parsed < 0) {
      return 0;
    }
    if (parsed > 1) {
      return 1;
    }
    return parsed;
  }

  private resolvePositiveIntEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) {
      return fallback;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    return parsed;
  }

  private resolveWorkerMapReducePolicyEnv(name: string, fallback: 'kill' | 'drop'): 'kill' | 'drop' {
    const raw = process.env[name];
    if (!raw || raw.trim().length === 0) {
      return fallback;
    }
    return raw.trim().toLowerCase() === 'drop' ? 'drop' : 'kill';
  }

  private resolveBoolEnv(name: string, fallback: boolean): boolean {
    const raw = process.env[name];
    if (!raw || raw.trim().length === 0) {
      return fallback;
    }
    return /^(1|true|yes|on)$/i.test(raw.trim());
  }

  private resolveCsvEnv(name: string): string[] {
    const raw = process.env[name];
    if (!raw || raw.trim().length === 0) {
      return [];
    }
    return raw
      .split(',')
      .map((item) => this.normalizePointerToken(item))
      .filter((item) => item.length > 0);
  }

  private normalizePointerToken(pointer: string): string {
    return pointer.trim().replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase();
  }

  private shouldEnforceStrictIntegerWrite(pointer: string): boolean {
    if (this.strictIntegerWriteFiles.length === 0) {
      return false;
    }
    const normalizedPointer = this.normalizePointerToken(pointer);
    if (normalizedPointer.length === 0) {
      return false;
    }
    const baseName = path.posix.basename(normalizedPointer);
    return this.strictIntegerWriteFiles.some(
      (entry) =>
        entry === normalizedPointer ||
        entry === baseName ||
        normalizedPointer.endsWith(`/${entry}`)
    );
  }

  private normalizeStrictIntegerPayload(
    pointer: string,
    payload: string
  ): { payload: string; coerced: boolean; reason: 'canonicalize' | 'extract_last_int' } {
    if (!this.shouldEnforceStrictIntegerWrite(pointer)) {
      return { payload, coerced: false, reason: 'canonicalize' };
    }
    const trimmed = payload.trim();
    if (/^-?[0-9]+$/.test(trimmed)) {
      const canonical = `${trimmed}\n`;
      return { payload: canonical, coerced: canonical !== payload, reason: 'canonicalize' };
    }
    if (!this.strictIntegerWriteCoerce) {
      throw new Error(`STRICT_INTEGER_WRITE_REJECTED pointer=${pointer}`);
    }
    if (this.strictIntegerWriteExtractLastInt) {
      const allMatches = trimmed.match(/-?[0-9]+/g);
      if (allMatches && allMatches.length > 0) {
        return { payload: `${allMatches[allMatches.length - 1]}\n`, coerced: true, reason: 'extract_last_int' };
      }
    }
    throw new Error(`STRICT_INTEGER_WRITE_REJECTED pointer=${pointer}`);
  }

  private isWorkerOutputRedFlag(output: string): boolean {
    const text = output.toUpperCase();
    return (
      text.includes('[FAILED DUE TO RED FLAGS]') ||
      text.includes('[RED_FLAG]') ||
      text.includes('[KILLED]')
    );
  }

  private extractWorkerVoteToken(output: string): string | null {
    const marker = output.match(/RESULT\s*:\s*(-?[0-9]+)/i);
    if (marker && marker[1]) {
      return marker[1];
    }
    const trimmed = output.trim();
    if (/^-?[0-9]+$/.test(trimmed)) {
      return trimmed;
    }
    return null;
  }

  private tallyVotes(tokens: string[]): Array<{ token: string; count: number }> {
    const counts = new Map<string, number>();
    for (const token of tokens) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([token, count]) => ({ token, count }))
      .sort((a, b) => b.count - a.count || a.token.localeCompare(b.token));
  }

  private async evaluateWriteThrashingAfterWrite(
    pcb: PCB,
    op: Extract<Syscall, { op: 'SYS_WRITE' }>,
    dBefore: string
  ): Promise<void> {
    if (this.maxRepeatWriteStreak <= 0) {
      return;
    }
    const pointer = typeof op.semantic_cap === 'string' && op.semantic_cap.trim().length > 0
      ? op.semantic_cap.trim()
      : dBefore;
    const signature = `${pointer}\n${op.payload}`;
    const lastSignature = this.readRegisterString(pcb, 'lastWriteSignature');
    const streak = signature === lastSignature
      ? this.readRegisterNumber(pcb, 'writeRepeatStreak') + 1
      : 1;
    this.writeRegisterString(pcb, 'lastWriteSignature', signature);
    this.writeRegisterNumber(pcb, 'writeRepeatStreak', streak);
    if (streak < this.maxRepeatWriteStreak) {
      return;
    }
    const verifier = this.verifier.verify();
    if (!verifier.passed) {
      return;
    }

    pcb.exitOutput = this.readRegisterString(pcb, 'q');
    pcb.state = 'PENDING_HALT';
    this.writeRegisterString(pcb, 'lastWriteSignature', '');
    this.writeRegisterNumber(pcb, 'writeRepeatStreak', 0);
    await this.chronos.engrave(
      `[HYPERCORE_HALT_ASSIST] pid=${pcb.pid} reason=write_thrashing_ready_to_halt streak=${streak}`
    );
  }

  private computeWorkspaceHash(workspaceDir: string): string {
    try {
      const hash = createHash('sha256');
      const walk = (dir: string) => {
        const files = fs.readdirSync(dir);
        for (const file of files.sort()) {
          if (file === '.git' || file === 'node_modules' || file.endsWith('.tmp')) continue;
          const fullPath = path.join(dir, file);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) walk(fullPath);
          else if (stat.isFile()) {
            hash.update(fullPath);
            hash.update(fs.readFileSync(fullPath));
          }
        }
      };
      walk(workspaceDir);
      return hash.digest('hex');
    } catch {
      return '';
    }
  }
}
