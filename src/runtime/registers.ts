import fs from 'node:fs';
import path from 'node:path';
import { Pointer, State } from '../kernel/types.js';

export class FileRegisters {
  private qFile: string;
  private dFile: string;

  constructor(private workspaceDir: string) {
    this.qFile = path.join(workspaceDir, '.reg_q');
    this.dFile = path.join(workspaceDir, '.reg_d');
    fs.mkdirSync(workspaceDir, { recursive: true });
  }

  public bootstrap(initialQ: State, initialD: Pointer): void {
    if (!fs.existsSync(this.qFile)) {
      fs.writeFileSync(this.qFile, `${initialQ.trim()}\n`, 'utf-8');
    }

    if (!fs.existsSync(this.dFile)) {
      fs.writeFileSync(this.dFile, `${initialD.trim()}\n`, 'utf-8');
    }
  }

  public readQ(): State {
    return fs.readFileSync(this.qFile, 'utf-8').trim();
  }

  public readD(): Pointer {
    return fs.readFileSync(this.dFile, 'utf-8').trim();
  }

  public write(q: State, d: Pointer): void {
    fs.writeFileSync(this.qFile, `${q.trim()}\n`, 'utf-8');
    fs.writeFileSync(this.dFile, `${d.trim()}\n`, 'utf-8');
  }
}
