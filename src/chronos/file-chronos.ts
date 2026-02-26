import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { IChronos } from '../kernel/types.js';

export class FileChronos implements IChronos {
  private merkleLogFilePath: string;
  private chainInitialized = false;
  private lastHash = 'GENESIS';

  constructor(private logFilePath: string) {
    fs.mkdirSync(path.dirname(this.logFilePath), { recursive: true });
    this.merkleLogFilePath = path.join(path.dirname(this.logFilePath), '.journal.merkle.jsonl');
  }

  public async engrave(entry: string): Promise<void> {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${entry}\n`;
    fs.appendFileSync(this.logFilePath, line, 'utf-8');

    this.initializeMerkleChain();

    const payload = {
      ts: timestamp,
      entry,
      prev_hash: this.lastHash,
    };
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const record = { ...payload, hash };
    fs.appendFileSync(this.merkleLogFilePath, `${JSON.stringify(record)}\n`, 'utf-8');
    this.lastHash = hash;
  }

  public async readReplayCursor(): Promise<{ tickSeq: number; merkleRoot: string } | null> {
    if (!fs.existsSync(this.logFilePath)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(this.logFilePath, 'utf-8');
      const lines = raw
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      for (let idx = lines.length - 1; idx >= 0; idx -= 1) {
        const line = lines[idx];
        const match = line.match(/\[REPLAY_TUPLE\]\s*(\{.*\})$/);
        if (!match?.[1]) {
          continue;
        }
        const parsed = JSON.parse(match[1]) as { tick_seq?: unknown; merkle_root?: unknown };
        const tickSeqRaw = parsed.tick_seq;
        const merkleRootRaw = parsed.merkle_root;
        if (typeof tickSeqRaw === 'number' && Number.isFinite(tickSeqRaw) && typeof merkleRootRaw === 'string') {
          return {
            tickSeq: tickSeqRaw + 1,
            merkleRoot: merkleRootRaw,
          };
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  private initializeMerkleChain(): void {
    if (this.chainInitialized) {
      return;
    }

    this.chainInitialized = true;
    if (!fs.existsSync(this.merkleLogFilePath)) {
      return;
    }

    try {
      const raw = fs.readFileSync(this.merkleLogFilePath, 'utf-8');
      const lines = raw
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      const lastLine = lines[lines.length - 1];
      if (!lastLine) {
        return;
      }

      const parsed = JSON.parse(lastLine) as { hash?: unknown };
      if (typeof parsed.hash === 'string' && parsed.hash.trim().length > 0) {
        this.lastHash = parsed.hash;
      }
    } catch {
      this.lastHash = 'GENESIS';
    }
  }
}
