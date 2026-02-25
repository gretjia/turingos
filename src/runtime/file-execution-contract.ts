import fs from 'node:fs/promises';
import path from 'node:path';
import { ContractCheckResult, IExecutionContract } from '../kernel/types.js';

type PrimitiveValue = string | number | boolean;

interface StepTextExpectation {
  kind: 'text';
  path: string;
  exact: string;
}

interface StepIncludesExpectation {
  kind: 'includes';
  path: string;
  includes: string[];
}

interface StepRegexExpectation {
  kind: 'regex';
  path: string;
  pattern: string;
  flags?: string;
}

interface StepJsonExpectation {
  kind: 'json';
  path: string;
  expected: Record<string, PrimitiveValue>;
}

type StepExpectation = StepTextExpectation | StepIncludesExpectation | StepRegexExpectation | StepJsonExpectation;

interface ExecutionContractFile {
  enabled?: boolean;
  progress_file?: string;
  ordered_steps?: string[];
  required_files?: string[];
  step_file_map?: Record<string, string>;
  step_expectations?: Record<string, StepExpectation>;
}

interface ParsedDoneSteps {
  steps: string[];
}

export class FileExecutionContract implements IExecutionContract {
  public static readonly FILE_NAME = '.turingos.contract.json';

  private constructor(private workspaceDir: string, private config: ExecutionContractFile) {}

  public static async fromWorkspace(workspaceDir: string): Promise<FileExecutionContract | null> {
    const contractPath = path.join(workspaceDir, FileExecutionContract.FILE_NAME);
    let raw: string;
    try {
      raw = await fs.readFile(contractPath, 'utf-8');
    } catch {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as ExecutionContractFile;
      return new FileExecutionContract(workspaceDir, parsed);
    } catch {
      return null;
    }
  }

  public async checkProgress(): Promise<ContractCheckResult> {
    if (this.config.enabled === false) {
      return { ok: true };
    }

    const ordered = this.orderedSteps();
    if (ordered.length === 0) {
      return { ok: true };
    }

    const done = await this.readDoneSteps();

    for (let i = 0; i < done.steps.length; i += 1) {
      if (i >= ordered.length) {
        return {
          ok: false,
          reason: `Progress exceeds plan length at index ${i + 1}.`,
        };
      }

      if (done.steps[i] !== ordered[i]) {
        return {
          ok: false,
          reason: `Out-of-order progress at index ${i + 1}. Expected DONE:${ordered[i]} but got DONE:${done.steps[i]}.`,
        };
      }
      const stepReady = await this.checkStepReady(done.steps[i]);
      if (!stepReady.ok) {
        return stepReady;
      }
    }

    return { ok: true };
  }

  public async checkHalt(): Promise<ContractCheckResult> {
    if (this.config.enabled === false) {
      return { ok: true };
    }

    const ordered = this.orderedSteps();
    if (ordered.length > 0) {
      const done = await this.readDoneSteps();

      if (done.steps.length !== ordered.length) {
        return {
          ok: false,
          reason: `Plan incomplete for HALT. done=${done.steps.length} required=${ordered.length}.`,
        };
      }

      for (let i = 0; i < ordered.length; i += 1) {
        if (done.steps[i] !== ordered[i]) {
          return {
            ok: false,
            reason: `Plan mismatch for HALT at step ${i + 1}. Expected DONE:${ordered[i]} but got DONE:${done.steps[i]}.`,
          };
        }
      }
    }

    const requiredFiles = this.requiredFiles();
    for (const file of requiredFiles) {
      const exists = await this.fileExists(file);
      if (!exists) {
        return { ok: false, reason: `Required file missing for HALT: ${file}` };
      }
    }

    return { ok: true };
  }

  public async checkNextRequiredStepReady(): Promise<ContractCheckResult> {
    if (this.config.enabled === false) {
      return { ok: true };
    }

    const nextStep = await this.getNextRequiredStep();
    if (!nextStep) {
      return { ok: false, reason: 'Plan already complete; no further DONE append allowed.' };
    }

    return this.checkStepReady(nextStep);
  }

  public async getNextRequiredStep(): Promise<string | null> {
    if (this.config.enabled === false) {
      return null;
    }

    const ordered = this.orderedSteps();
    if (ordered.length === 0) {
      return null;
    }

    const done = await this.readDoneSteps();
    if (done.steps.length >= ordered.length) {
      return null;
    }

    return ordered[done.steps.length] ?? null;
  }

  public getProgressPath(): string {
    return this.progressPath();
  }

  public async getNextRequiredFileHint(): Promise<string | null> {
    if (this.config.enabled === false) {
      return null;
    }

    const nextStep = await this.getNextRequiredStep();
    if (!nextStep) {
      return null;
    }

    const map = this.stepFileMap();
    return map[nextStep] ?? null;
  }

  private orderedSteps(): string[] {
    return (this.config.ordered_steps ?? []).filter((step): step is string => typeof step === 'string');
  }

  private requiredFiles(): string[] {
    return (this.config.required_files ?? []).filter((item): item is string => typeof item === 'string');
  }

  private stepFileMap(): Record<string, string> {
    const value = this.config.step_file_map;
    if (!value || typeof value !== 'object') {
      return {};
    }

    const out: Record<string, string> = {};
    for (const [key, mapped] of Object.entries(value)) {
      if (typeof key === 'string' && typeof mapped === 'string' && key.trim() && mapped.trim()) {
        out[key.trim()] = mapped.trim();
      }
    }
    return out;
  }

  private stepExpectations(): Record<string, StepExpectation> {
    const value = this.config.step_expectations;
    if (!value || typeof value !== 'object') {
      return {};
    }

    const out: Record<string, StepExpectation> = {};
    for (const [stepId, raw] of Object.entries(value)) {
      if (!stepId || typeof stepId !== 'string' || !raw || typeof raw !== 'object') {
        continue;
      }

      const kind = (raw as { kind?: unknown }).kind;
      const filePath = (raw as { path?: unknown }).path;
      if (typeof filePath !== 'string' || !filePath.trim()) {
        continue;
      }

      if (kind === 'text') {
        const exact = (raw as { exact?: unknown }).exact;
        if (typeof exact !== 'string') {
          continue;
        }
        out[stepId.trim()] = { kind: 'text', path: filePath.trim(), exact };
        continue;
      }

      if (kind === 'includes') {
        const includesRaw = (raw as { includes?: unknown }).includes;
        if (!Array.isArray(includesRaw)) {
          continue;
        }

        const includes = includesRaw
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter((item) => item.length > 0);
        if (includes.length === 0) {
          continue;
        }

        out[stepId.trim()] = { kind: 'includes', path: filePath.trim(), includes };
        continue;
      }

      if (kind === 'regex') {
        const pattern = (raw as { pattern?: unknown }).pattern;
        const flags = (raw as { flags?: unknown }).flags;
        if (typeof pattern !== 'string' || pattern.trim().length === 0) {
          continue;
        }

        out[stepId.trim()] = {
          kind: 'regex',
          path: filePath.trim(),
          pattern: pattern.trim(),
          flags: typeof flags === 'string' ? flags : undefined,
        };
        continue;
      }

      if (kind === 'json') {
        const expectedRaw = (raw as { expected?: unknown }).expected;
        if (!expectedRaw || typeof expectedRaw !== 'object') {
          continue;
        }

        const expected: Record<string, PrimitiveValue> = {};
        for (const [k, v] of Object.entries(expectedRaw as Record<string, unknown>)) {
          if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
            expected[k] = v;
          }
        }
        out[stepId.trim()] = { kind: 'json', path: filePath.trim(), expected };
      }
    }
    return out;
  }

  private progressPath(): string {
    return this.config.progress_file ?? 'plan/progress.log';
  }

  private async readDoneSteps(): Promise<ParsedDoneSteps> {
    const progressFile = this.resolveWorkspacePath(this.progressPath());
    let raw = '';
    try {
      raw = await fs.readFile(progressFile, 'utf-8');
    } catch {
      return { steps: [] };
    }

    const lines = raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const steps: string[] = [];
    for (const line of lines) {
      if (!line.startsWith('DONE:')) {
        continue;
      }

      const step = line.slice('DONE:'.length).trim();
      if (step.length === 0) {
        continue;
      }
      steps.push(step);
    }

    return { steps };
  }

  private resolveWorkspacePath(pointer: string): string {
    const normalized = pointer.replace(/^\.\//, '');
    const resolved = path.resolve(this.workspaceDir, normalized);
    const workspaceRoot = path.resolve(this.workspaceDir);

    if (resolved !== workspaceRoot && !resolved.startsWith(`${workspaceRoot}${path.sep}`)) {
      throw new Error(`Path escapes workspace: ${pointer}`);
    }

    return resolved;
  }

  private async fileExists(pointer: string): Promise<boolean> {
    const target = this.resolveWorkspacePath(pointer);
    try {
      await fs.access(target);
      return true;
    } catch {
      return false;
    }
  }

  private async checkStepReady(stepId: string): Promise<ContractCheckResult> {
    const mappedFile = this.stepFileMap()[stepId];
    if (!mappedFile) {
      return { ok: true };
    }

    const exists = await this.fileExists(mappedFile);
    if (!exists) {
      return {
        ok: false,
        reason: `required file is missing for DONE:${stepId} -> ${mappedFile}.`,
      };
    }

    const expectation = this.stepExpectations()[stepId];
    if (!expectation) {
      return { ok: true };
    }

    const targetFile = expectation.path;
    const expectationExists = await this.fileExists(targetFile);
    if (!expectationExists) {
      return {
        ok: false,
        reason: `required file is missing for DONE:${stepId} -> ${targetFile}.`,
      };
    }

    let raw = '';
    try {
      raw = await fs.readFile(this.resolveWorkspacePath(targetFile), 'utf-8');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        reason: `required file content mismatch for DONE:${stepId} -> ${targetFile}. read failed: ${message}`,
      };
    }

    if (expectation.kind === 'text') {
      const actual = this.normalizeText(raw);
      const expected = this.normalizeText(expectation.exact);
      if (actual !== expected) {
        const mismatch = this.firstTextMismatch(expected, actual);
        return {
          ok: false,
          reason: `required file content mismatch for DONE:${stepId} -> ${targetFile}. ${mismatch}`,
        };
      }
      return { ok: true };
    }

    if (expectation.kind === 'includes') {
      const actual = this.normalizeText(raw);
      const missing = expectation.includes.find((item) => !actual.includes(this.normalizeText(item)));
      if (missing) {
        return {
          ok: false,
          reason: `required file content mismatch for DONE:${stepId} -> ${targetFile}. missing segment="${this.preview(
            missing
          )}".`,
        };
      }
      return { ok: true };
    }

    if (expectation.kind === 'regex') {
      let regex: RegExp;
      try {
        regex = new RegExp(expectation.pattern, expectation.flags ?? '');
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          reason: `required file content mismatch for DONE:${stepId} -> ${targetFile}. invalid regex expectation: ${message}`,
        };
      }

      if (!regex.test(raw)) {
        return {
          ok: false,
          reason: `required file content mismatch for DONE:${stepId} -> ${targetFile}. regex not matched: /${expectation.pattern}/${
            expectation.flags ?? ''
          }.`,
        };
      }
      return { ok: true };
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const [key, value] of Object.entries(expectation.expected)) {
        if (parsed[key] !== value) {
          const actualValue = parsed[key];
          return {
            ok: false,
            reason: `required file content mismatch for DONE:${stepId} -> ${targetFile}. json key ${key} mismatch. expected=${JSON.stringify(
              value
            )} actual=${JSON.stringify(actualValue)}.`,
          };
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        reason: `required file content mismatch for DONE:${stepId} -> ${targetFile}. invalid json: ${message}`,
      };
    }

    return { ok: true };
  }

  private normalizeText(text: string): string {
    return text.replace(/\r\n/g, '\n').trim();
  }

  private preview(text: string): string {
    const compact = text.replace(/\s+/g, ' ').trim();
    if (compact.length <= 180) {
      return compact;
    }
    return `${compact.slice(0, 177)}...`;
  }

  private firstTextMismatch(expected: string, actual: string): string {
    const expectedLines = expected.split('\n');
    const actualLines = actual.split('\n');
    const max = Math.max(expectedLines.length, actualLines.length);

    for (let i = 0; i < max; i += 1) {
      const expectedLine = expectedLines[i] ?? '';
      const actualLine = actualLines[i] ?? '';
      if (expectedLine !== actualLine) {
        return `first_diff_line=${i + 1} expected="${this.preview(expectedLine)}" actual="${this.preview(actualLine)}"`;
      }
    }

    return `expected="${this.preview(expected)}" actual="${this.preview(actual)}"`;
  }
}
