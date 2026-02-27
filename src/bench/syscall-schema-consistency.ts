import fs from 'node:fs/promises';
import path from 'node:path';
import {
  SYSCALL_EXACT_FIELD_PROMPT_LINES,
  SYSCALL_OPCODES,
} from '../kernel/syscall-schema.js';

interface SchemaDoc {
  version?: string;
  opcodes?: unknown;
  exact_field_prompt_lines?: unknown;
}

interface ConsistencyReport {
  stamp: string;
  schemaPath: string;
  promptPath: string;
  checks: Array<{ id: string; pass: boolean; details: string }>;
  pass: boolean;
}

const ROOT = path.resolve(process.cwd());
const SCHEMA_PATH = path.join(ROOT, 'schemas', 'syscall-frame.v4.json');
const PROMPT_PATH = path.join(ROOT, 'turing_prompt.sh');
const AUDIT_DIR = path.join(ROOT, 'benchmarks', 'audits', 'protocol');
const LATEST_JSON = path.join(AUDIT_DIR, 'syscall_schema_consistency_latest.json');
const LATEST_MD = path.join(AUDIT_DIR, 'syscall_schema_consistency_latest.md');

function timestamp(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function equalStringArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function parsePromptOpcodeList(promptRaw: string): string[] {
  const line = promptRaw
    .split('\n')
    .map((raw) => raw.trim())
    .find((raw) => raw.includes('"op":') && raw.includes('SYS_'));
  if (!line) {
    return [];
  }
  const match = line.match(/"op"\s*:\s*"([^"]+)"/);
  if (!match?.[1]) {
    return [];
  }
  return match[1]
    .split('|')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function toMarkdown(report: ConsistencyReport, jsonPath: string): string {
  const rows = report.checks
    .map((check) => `| ${check.id} | ${check.pass ? 'PASS' : 'FAIL'} | ${check.details} |`)
    .join('\n');
  return [
    '# Syscall Schema Consistency Gate',
    '',
    `- stamp: ${report.stamp}`,
    `- schema: ${report.schemaPath}`,
    `- prompt: ${report.promptPath}`,
    `- pass: ${report.pass}`,
    `- report_json: ${jsonPath}`,
    '',
    '| Check | Result | Details |',
    '|---|---|---|',
    rows,
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  await fs.mkdir(AUDIT_DIR, { recursive: true });

  const schemaRaw = await fs.readFile(SCHEMA_PATH, 'utf-8');
  const promptRaw = await fs.readFile(PROMPT_PATH, 'utf-8');
  const parsed = JSON.parse(schemaRaw) as SchemaDoc;
  const schemaOpcodes = toStringArray(parsed.opcodes);
  const schemaPromptLines = toStringArray(parsed.exact_field_prompt_lines);
  const promptOpcodes = parsePromptOpcodeList(promptRaw);
  const canonicalOpcodes = [...SYSCALL_OPCODES];
  const canonicalPromptLines = [...SYSCALL_EXACT_FIELD_PROMPT_LINES];

  const checks: ConsistencyReport['checks'] = [];
  checks.push({
    id: 'schema.opcodes == canonical',
    pass: equalStringArray(schemaOpcodes, canonicalOpcodes),
    details: `schema=${schemaOpcodes.join('|') || '(empty)'} canonical=${canonicalOpcodes.join('|')}`,
  });
  checks.push({
    id: 'schema.exact_field_prompt_lines == canonical',
    pass: equalStringArray(schemaPromptLines, canonicalPromptLines),
    details: `schema_lines=${schemaPromptLines.length} canonical_lines=${canonicalPromptLines.length}`,
  });
  checks.push({
    id: 'prompt opcode list == canonical',
    pass: equalStringArray(promptOpcodes, canonicalOpcodes),
    details: `prompt=${promptOpcodes.join('|') || '(empty)'} canonical=${canonicalOpcodes.join('|')}`,
  });
  checks.push({
    id: 'prompt includes SYS_MOVE fail-closed rule',
    pass: /SYS_MOVE allows only:\s*op,\s*optional task_id,\s*optional target_pos,\s*optional status/i.test(promptRaw),
    details: 'expected explicit SYS_MOVE allowlist line in turing_prompt.sh',
  });

  const stamp = timestamp();
  const report: ConsistencyReport = {
    stamp,
    schemaPath: SCHEMA_PATH,
    promptPath: PROMPT_PATH,
    checks,
    pass: checks.every((check) => check.pass),
  };
  const reportJsonPath = path.join(AUDIT_DIR, `syscall_schema_consistency_${stamp}.json`);
  const reportMdPath = path.join(AUDIT_DIR, `syscall_schema_consistency_${stamp}.md`);

  await fs.writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fs.writeFile(reportMdPath, `${toMarkdown(report, reportJsonPath)}\n`, 'utf-8');
  await fs.writeFile(LATEST_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fs.writeFile(LATEST_MD, `${toMarkdown(report, reportJsonPath)}\n`, 'utf-8');

  for (const check of checks) {
    console.log(`[schema-consistency] ${check.pass ? 'PASS' : 'FAIL'} ${check.id}: ${check.details}`);
  }
  console.log(`[schema-consistency] report=${reportJsonPath}`);
  if (!report.pass) {
    console.error('[schema-consistency] FAIL');
    process.exitCode = 1;
    return;
  }
  console.log('[schema-consistency] PASS');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[schema-consistency] fatal: ${message}`);
  process.exitCode = 1;
});
