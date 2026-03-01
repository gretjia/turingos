import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseProviderBusTransition } from '../oracle/turing-bus-adapter.js';

type Provider = 'openai' | 'kimi' | 'ollama';

interface CaseResult {
  id: string;
  provider: Provider;
  expect: 'accept' | 'reject';
  pass: boolean;
  details: string;
}

interface Report {
  stamp: string;
  pass: boolean;
  schemaChecks: Array<{ id: string; pass: boolean; details: string }>;
  caseResults: CaseResult[];
  totals: {
    acceptPass: number;
    acceptTotal: number;
    rejectPass: number;
    rejectTotal: number;
  };
}

const ROOT = path.resolve(process.cwd());
const BUS_SCHEMA_PATH = path.join(ROOT, 'schemas', 'turing-bus.frame.v2.json');
const SYSCALL_SCHEMA_PATH = path.join(ROOT, 'schemas', 'syscall-frame.v5.json');
const AUDIT_DIR = path.join(ROOT, 'benchmarks', 'audits', 'protocol');
const LATEST_JSON = path.join(AUDIT_DIR, 'turing_bus_conformance_latest.json');
const LATEST_MD = path.join(AUDIT_DIR, 'turing_bus_conformance_latest.md');

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

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function flattenInstructionClasses(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  const record = value as Record<string, unknown>;
  const values = Object.values(record);
  const merged: string[] = [];
  for (const entry of values) {
    merged.push(...asStringArray(entry));
  }
  return merged;
}

function toMarkdown(report: Report, jsonPath: string): string {
  return [
    '# Turing Bus Conformance',
    '',
    `- stamp: ${report.stamp}`,
    `- pass: ${report.pass}`,
    `- report_json: ${jsonPath}`,
    '',
    '## Schema Checks',
    '',
    '| Check | Result | Details |',
    '|---|---|---|',
    ...report.schemaChecks.map((item) => `| ${item.id} | ${item.pass ? 'PASS' : 'FAIL'} | ${item.details} |`),
    '',
    '## Provider Cases',
    '',
    '| Case | Provider | Expect | Result | Details |',
    '|---|---|---|---|---|',
    ...report.caseResults.map(
      (item) =>
        `| ${item.id} | ${item.provider} | ${item.expect} | ${item.pass ? 'PASS' : 'FAIL'} | ${item.details} |`
    ),
    '',
    `- accept_pass: ${report.totals.acceptPass}/${report.totals.acceptTotal}`,
    `- reject_pass: ${report.totals.rejectPass}/${report.totals.rejectTotal}`,
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  await fs.mkdir(AUDIT_DIR, { recursive: true });

  const busRaw = await fs.readFile(BUS_SCHEMA_PATH, 'utf-8');
  const syscallRaw = await fs.readFile(SYSCALL_SCHEMA_PATH, 'utf-8');
  const busSchema = JSON.parse(busRaw) as Record<string, unknown>;
  const syscallSchema = JSON.parse(syscallRaw) as Record<string, unknown>;

  const busVersion = typeof busSchema.version === 'string' ? busSchema.version : '';
  const busProviders =
    busSchema.providers && typeof busSchema.providers === 'object' && !Array.isArray(busSchema.providers)
      ? Object.keys(busSchema.providers as Record<string, unknown>)
      : [];
  const busOps = flattenInstructionClasses(busSchema.instruction_classes).sort();
  const syscallOps = asStringArray(syscallSchema.opcodes).sort();

  const schemaChecks: Report['schemaChecks'] = [
    {
      id: 'bus_schema.version_present',
      pass: busVersion.length > 0,
      details: `version=${busVersion || '(missing)'}`,
    },
    {
      id: 'bus_schema.providers_include_openai_kimi_ollama',
      pass: ['openai', 'kimi', 'ollama'].every((provider) => busProviders.includes(provider)),
      details: `providers=${busProviders.join(',') || '(none)'}`,
    },
    {
      id: 'bus_instruction_classes_match_syscall_schema',
      pass: JSON.stringify(busOps) === JSON.stringify(syscallOps),
      details: `bus_ops=${busOps.join('|')} syscall_ops=${syscallOps.join('|')}`,
    },
  ];

  const validCases: Array<{ id: string; provider: Provider; payload: unknown }> = [
    {
      id: 'openai_valid_with_think_prefix',
      provider: 'openai',
      payload: {
        choices: [
          {
            message: {
              content:
                '<think>quick planner scratchpad</think>\n{"q_next":"state_openai_think","mind_ops":[{"op":"SYS_EDIT","task":"sync plan"}],"world_op":{"op":"SYS_GOTO","pointer":"MAIN_TAPE.md"}}',
            },
          },
        ],
        usage: { prompt_tokens: 11, completion_tokens: 9, total_tokens: 20 },
      },
    },
    {
      id: 'openai_valid_vliw_world_only',
      provider: 'openai',
      payload: {
        choices: [
          {
            message: {
              content: '{"q_next":"state_openai","mind_ops":[],"world_op":{"op":"SYS_GOTO","pointer":"MAIN_TAPE.md"}}',
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 7, total_tokens: 17 },
      },
    },
    {
      id: 'kimi_valid_vliw',
      provider: 'kimi',
      payload: {
        content: [
          {
            type: 'text',
            text:
              '{"q_next":"state_kimi","mind_ops":[{"op":"SYS_EDIT","task":"refine plan"},{"op":"SYS_PUSH","task":"run targeted test"}],"world_op":{"op":"SYS_EXEC","cmd":"npm test"}}',
          },
        ],
        usage: { input_tokens: 12, output_tokens: 6, total_tokens: 18 },
      },
    },
    {
      id: 'ollama_valid_mind_only',
      provider: 'ollama',
      payload: {
        message: {
          content:
            '{"q_next":"state_ollama","mind_ops":[{"op":"SYS_MOVE","target_pos":"BOTTOM","status":"SUSPENDED"}],"world_op":null}',
        },
        prompt_eval_count: 8,
        eval_count: 5,
      },
    },
    {
      id: 'openai_guardrail_multiple_world_ops',
      provider: 'openai',
      payload: {
        choices: [
          {
            message: {
              content:
                '{"q_next":"guardrail","mind_ops":[{"op":"SYS_EDIT","task":"x"}],"world_ops":[{"op":"SYS_WRITE","payload":"x"},{"op":"SYS_HALT"}]}',
            },
          },
        ],
      },
    },
  ];

  const invalidCases: Array<{ id: string; provider: Provider; payload: unknown }> = [
    {
      id: 'openai_reject_mutex_violation',
      provider: 'openai',
      payload: {
        choices: [
          {
            message: {
              content: '{"q_next":"bad","a_t":{"op":"SYS_GOTO","pointer":"MAIN_TAPE.md","payload":"illegal"}}',
            },
          },
        ],
      },
    },
    {
      id: 'kimi_reject_invalid_opcode',
      provider: 'kimi',
      payload: {
        content: [
          {
            type: 'text',
            text: '{"q_next":"bad","mind_ops":[{"op":"SYS_TELEPORT","pointer":"MAIN_TAPE.md"}]}',
          },
        ],
      },
    },
    {
      id: 'ollama_reject_unknown_world_opcode',
      provider: 'ollama',
      payload: {
        response: '{"q_next":"bad","world_op":{"op":"SYS_TELEPORT","pointer":"MAIN_TAPE.md"}}',
      },
    },
  ];

  const caseResults: CaseResult[] = [];

  for (const item of validCases) {
    try {
      const parsed = parseProviderBusTransition(item.provider, item.payload);
      assert.ok(parsed.transition.a_t.op.startsWith('SYS_'));
      const mindOps = (parsed.transition.mind_ops ?? []).map((op) => op.op);
      const worldOp = parsed.transition.world_op?.op ?? '(none)';
      caseResults.push({
        id: item.id,
        provider: item.provider,
        expect: 'accept',
        pass: true,
        details: `a_t=${parsed.transition.a_t.op} mind_ops=${mindOps.join('|') || '(none)'} world_op=${worldOp}`,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      caseResults.push({
        id: item.id,
        provider: item.provider,
        expect: 'accept',
        pass: false,
        details: message,
      });
    }
  }

  for (const item of invalidCases) {
    try {
      parseProviderBusTransition(item.provider, item.payload);
      caseResults.push({
        id: item.id,
        provider: item.provider,
        expect: 'reject',
        pass: false,
        details: 'unexpected accept',
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      caseResults.push({
        id: item.id,
        provider: item.provider,
        expect: 'reject',
        pass: true,
        details: message.slice(0, 180),
      });
    }
  }

  const acceptCases = caseResults.filter((item) => item.expect === 'accept');
  const rejectCases = caseResults.filter((item) => item.expect === 'reject');
  const totals = {
    acceptPass: acceptCases.filter((item) => item.pass).length,
    acceptTotal: acceptCases.length,
    rejectPass: rejectCases.filter((item) => item.pass).length,
    rejectTotal: rejectCases.length,
  };

  const report: Report = {
    stamp: timestamp(),
    pass: schemaChecks.every((item) => item.pass) && caseResults.every((item) => item.pass),
    schemaChecks,
    caseResults,
    totals,
  };

  const reportJsonPath = path.join(AUDIT_DIR, `turing_bus_conformance_${report.stamp}.json`);
  const reportMdPath = path.join(AUDIT_DIR, `turing_bus_conformance_${report.stamp}.md`);
  await fs.writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fs.writeFile(reportMdPath, `${toMarkdown(report, reportJsonPath)}\n`, 'utf-8');
  await fs.writeFile(LATEST_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fs.writeFile(LATEST_MD, `${toMarkdown(report, reportJsonPath)}\n`, 'utf-8');

  for (const check of schemaChecks) {
    console.log(`[bus-conformance] ${check.pass ? 'PASS' : 'FAIL'} ${check.id}: ${check.details}`);
  }
  for (const row of caseResults) {
    console.log(
      `[bus-conformance] ${row.pass ? 'PASS' : 'FAIL'} ${row.id} provider=${row.provider} expect=${row.expect}: ${row.details}`
    );
  }
  console.log(`[bus-conformance] report=${reportJsonPath}`);
  if (!report.pass) {
    console.error('[bus-conformance] FAIL');
    process.exitCode = 1;
    return;
  }
  console.log('[bus-conformance] PASS');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[bus-conformance] fatal: ${message}`);
  process.exitCode = 1;
});
