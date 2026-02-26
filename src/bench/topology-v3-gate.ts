import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileChronos } from '../chronos/file-chronos.js';
import { TuringEngine } from '../kernel/engine.js';
import { IOracle, Slice, State, Transition } from '../kernel/types.js';
import { LocalManifold } from '../manifold/local-manifold.js';

interface CheckResult {
  name: string;
  passed: boolean;
  details?: string;
}

class CapabilityWriteOracle implements IOracle {
  constructor(private handle: string) {}

  public async collapse(_discipline: string, _q: State, _s: Slice): Promise<Transition> {
    return {
      q_next: 'q_cap_done',
      a_t: {
        op: 'SYS_WRITE',
        payload: 'CAP_OK',
        semantic_cap: this.handle,
      },
    };
  }
}

function mkWorkspace(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function parseHandle(issued: string): string {
  const handle = issued
    .split('\n')
    .find((line) => line.startsWith('[HANDLE] '))
    ?.replace('[HANDLE] ', '')
    .trim();
  assert.ok(handle && handle.startsWith('vfd://'), `Failed to parse capability handle from: ${issued}`);
  return handle;
}

async function checkTypedPaging(): Promise<CheckResult> {
  const ws = mkWorkspace('turingos-gate-paging-');
  const manifold = new LocalManifold(ws, { maxSliceChars: 80 });
  const longText = Array.from({ length: 40 }, (_, i) => `line-${i.toString().padStart(2, '0')}:0123456789`).join('\n');
  await manifold.interfere('logs/long.txt', longText);

  const page1 = await manifold.observe('logs/long.txt');
  assert.ok(page1.includes('[PAGE_TABLE_SUMMARY]'), 'Expected page summary for oversized slice');
  const token = page1.match(/Token=([a-f0-9]+)/)?.[1];
  assert.ok(token, 'Missing page token');
  const page2 = await manifold.observe(`sys://page/${token}?p=2`);
  assert.ok(page2.includes('FocusPage=2'), 'Expected second page view');

  return {
    name: 'Typed Paging',
    passed: true,
    details: `workspace=${ws}, token=${token}`,
  };
}

async function checkSemanticCapability(): Promise<CheckResult> {
  const ws = mkWorkspace('turingos-gate-vfd-');
  const manifold = new LocalManifold(ws, { maxSliceChars: 2000 });
  await manifold.interfere('notes.txt', 'hello');

  const issuedRw = await manifold.observe('sys://cap/issue/notes.txt?access=rw');
  const rwHandle = parseHandle(issuedRw);
  const readViaHandle = await manifold.observe(rwHandle);
  assert.equal(readViaHandle, 'hello', 'Read via rw handle mismatch');

  await manifold.interfere(rwHandle, 'world');
  const afterWrite = await manifold.observe('notes.txt');
  assert.equal(afterWrite, 'world', 'Write via rw handle mismatch');

  const issuedR = await manifold.observe('sys://cap/issue/notes.txt?access=r');
  const rHandle = parseHandle(issuedR);
  let blocked = false;
  try {
    await manifold.interfere(rHandle, 'blocked');
  } catch {
    blocked = true;
  }
  assert.equal(blocked, true, 'Read-only handle should block writes');

  const capFile = path.join(ws, '.vfd_caps.json');
  const capRaw = await fsp.readFile(capFile, 'utf-8');
  const capJson = JSON.parse(capRaw) as { entries?: unknown[] };
  assert.ok(Array.isArray(capJson.entries) && capJson.entries.length >= 2, 'Capability persistence missing entries');

  return {
    name: 'Semantic Capability',
    passed: true,
    details: `workspace=${ws}, rw=${rwHandle}, r=${rHandle}`,
  };
}

async function checkCallStackEdit(): Promise<CheckResult> {
  const ws = mkWorkspace('turingos-gate-stack-edit-');
  const manifold = new LocalManifold(ws, { maxSliceChars: 2000 });
  await manifold.interfere('sys://callstack', 'PUSH: investigate trap details');
  await manifold.interfere('sys://callstack', 'EDIT: investigate trap details with new evidence');
  const snapshot = await manifold.observe('sys://callstack');
  assert.ok(
    snapshot.includes('[CALL_STACK_TOP] investigate trap details with new evidence'),
    'Expected edited top stack frame'
  );

  return {
    name: 'Callstack SYS_EDIT',
    passed: true,
    details: `workspace=${ws}`,
  };
}

async function checkEngineSemanticWrite(): Promise<CheckResult> {
  const ws = mkWorkspace('turingos-gate-engine-cap-');
  const manifold = new LocalManifold(ws, { maxSliceChars: 2000 });
  await manifold.interfere('MAIN_TAPE.md', 'seed');
  const issued = await manifold.observe('sys://cap/issue/out.txt?access=rw');
  const handle = parseHandle(issued);
  const chronos = new FileChronos(path.join(ws, '.journal.log'));
  const engine = new TuringEngine(manifold, new CapabilityWriteOracle(handle), chronos, 'test');

  const [q1, d1] = await engine.tick('q0', 'MAIN_TAPE.md');
  const out = await manifold.observe('out.txt');
  assert.equal(q1, 'q_cap_done', 'Unexpected q_next');
  assert.equal(d1, 'MAIN_TAPE.md', 'SYS_WRITE should keep pointer progression backward-compatible');
  assert.equal(out, 'CAP_OK', 'Engine capability write failed');

  return {
    name: 'Engine SYS_WRITE.semantic_cap',
    passed: true,
    details: `workspace=${ws}, handle=${handle}`,
  };
}

async function checkNativeGitLogChannel(): Promise<CheckResult> {
  const ws = mkWorkspace('turingos-gate-git-log-');
  const manifold = new LocalManifold(ws, { maxSliceChars: 2000 });

  execFileSync('git', ['init', '-q'], { cwd: ws });
  execFileSync('git', ['config', 'user.email', 'gate@turingos.local'], { cwd: ws });
  execFileSync('git', ['config', 'user.name', 'Topology Gate'], { cwd: ws });

  const notePath = path.join(ws, 'notes.md');
  await fsp.writeFile(notePath, 'v1\n', 'utf-8');
  execFileSync('git', ['add', 'notes.md'], { cwd: ws });
  execFileSync('git', ['commit', '-qm', 'init notes'], { cwd: ws });

  await fsp.writeFile(notePath, 'v2\n', 'utf-8');
  execFileSync('git', ['add', 'notes.md'], { cwd: ws });
  execFileSync('git', ['commit', '-qm', 'update notes'], { cwd: ws });

  const gitLogSlice = await manifold.observe('sys://git/log?limit=2&path=notes.md');
  assert.ok(gitLogSlice.includes('[GIT_LOG]'), 'Expected native git log channel marker');
  assert.ok(gitLogSlice.includes('Rows=2'), 'Expected git log row count to respect limit');

  return {
    name: 'Native SYS_GIT_LOG channel',
    passed: true,
    details: `workspace=${ws}`,
  };
}

async function checkMerkleChain(): Promise<CheckResult> {
  const ws = mkWorkspace('turingos-gate-merkle-');
  const journalPath = path.join(ws, '.journal.log');
  const chronos = new FileChronos(journalPath);
  await chronos.engrave('entry-1');
  await chronos.engrave('entry-2');
  await chronos.engrave('entry-3');

  const merklePath = path.join(ws, '.journal.merkle.jsonl');
  const raw = await fsp.readFile(merklePath, 'utf-8');
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { prev_hash: string; hash: string });
  assert.equal(lines.length, 3, 'Expected 3 merkle entries');
  assert.equal(lines[0]?.prev_hash, 'GENESIS', 'First entry must point to GENESIS');
  assert.equal(lines[1]?.prev_hash, lines[0]?.hash, 'Second entry chain mismatch');
  assert.equal(lines[2]?.prev_hash, lines[1]?.hash, 'Third entry chain mismatch');

  return {
    name: 'Merkle Journal Chain',
    passed: true,
    details: `workspace=${ws}, entries=${lines.length}`,
  };
}

async function run(): Promise<void> {
  const checks: Array<() => Promise<CheckResult>> = [
    checkTypedPaging,
    checkSemanticCapability,
    checkCallStackEdit,
    checkEngineSemanticWrite,
    checkNativeGitLogChannel,
    checkMerkleChain,
  ];

  const results: CheckResult[] = [];
  for (const check of checks) {
    try {
      const result = await check();
      results.push(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        name: check.name,
        passed: false,
        details: message,
      });
    }
  }

  for (const result of results) {
    const tag = result.passed ? 'PASS' : 'FAIL';
    console.log(`[${tag}] ${result.name}${result.details ? ` :: ${result.details}` : ''}`);
  }

  const failed = results.filter((item) => !item.passed);
  if (failed.length > 0) {
    console.error(`Topology gate failed: ${failed.length}/${results.length} checks.`);
    process.exitCode = 1;
    return;
  }

  console.log(`Topology gate passed: ${results.length}/${results.length} checks.`);
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[topology-gate] fatal: ${message}`);
  process.exitCode = 1;
});
