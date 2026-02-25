import fs from 'node:fs';
import path from 'node:path';
import { IChronos } from '../kernel/types.js';

export class FileChronos implements IChronos {
  constructor(private logFilePath: string) {
    fs.mkdirSync(path.dirname(this.logFilePath), { recursive: true });
  }

  public async engrave(entry: string): Promise<void> {
    const line = `[${new Date().toISOString()}] ${entry}\n`;
    fs.appendFileSync(this.logFilePath, line, 'utf-8');
  }
}
