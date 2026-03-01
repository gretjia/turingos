import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

interface SearchRepoItem {
  full_name: string;
  html_url: string;
  stargazers_count: number;
  language: string | null;
  pushed_at: string;
  open_issues_count: number;
  default_branch: string;
  size: number;
  archived: boolean;
  fork: boolean;
}

interface WorkflowList {
  total_count: number;
}

interface IssueItem {
  number: number;
  title: string;
  html_url: string;
  body: string | null;
  comments: number;
  created_at: string;
  labels: Array<{ name: string }>;
  pull_request?: unknown;
}

interface RepoScoreBreakdown {
  reproducibility: number;
  ciVerifiability: number;
  systemEntropy: number;
  activityHealth: number;
  toolchainFriction: number;
}

interface CandidateRow {
  fullName: string;
  htmlUrl: string;
  language: string;
  stars: number;
  pushedAt: string;
  daysSincePush: number;
  openIssuesCount: number;
  sizeKb: number;
  workflowCount: number;
  selectedIssue: {
    number: number;
    title: string;
    htmlUrl: string;
    comments: number;
    labels: string[];
    bodyPreview: string;
    reproducibilitySignals: string[];
  } | null;
  score: RepoScoreBreakdown;
  weightedTotal: number;
  rejectReasons: string[];
}

interface CandidatePoolReport {
  stamp: string;
  generatedAt: string;
  policy: {
    recencyDays: number;
    minStars: number;
    maxStars: number;
    maxSizeKb: number;
    maxPerLanguage: number;
    maxRepoChecks: number;
    topK: number;
    weights: {
      reproducibility: number;
      ciVerifiability: number;
      systemEntropy: number;
      activityHealth: number;
      toolchainFriction: number;
    };
    queries: string[];
  };
  summary: {
    fetchedRepos: number;
    scoredRepos: number;
    shortlisted: number;
  };
  rows: CandidateRow[];
  shortlist: CandidateRow[];
}

const ROOT = path.resolve(process.cwd());
const AUDIT_DIR = path.join(ROOT, 'benchmarks', 'audits', 'longrun');
const HANDOVER_DIR = path.join(ROOT, 'handover');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timestamp(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mi = String(now.getUTCMinutes()).padStart(2, '0');
  const ss = String(now.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function daysSince(iso: string): number {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 9999;
  return Math.max(0, Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000)));
}

async function githubRequest<T>(pathname: string): Promise<T> {
  const preferGh = (process.env.WILD_OSS_USE_GH_API ?? '1').trim() !== '0';
  const allowUnauthFallback = (process.env.WILD_OSS_ALLOW_UNAUTH_FALLBACK ?? '0').trim() === '1';
  if (preferGh) {
    let lastError = '';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const out = execFileSync('gh', ['api', pathname], {
          encoding: 'utf-8',
          maxBuffer: 16 * 1024 * 1024,
          timeout: 20_000,
          killSignal: 'SIGKILL',
        });
        return JSON.parse(out) as T;
      } catch (error: unknown) {
        lastError = error instanceof Error ? error.message : String(error);
        await sleep(400 * (attempt + 1));
      }
    }
    if (!allowUnauthFallback) {
      throw new Error(`gh api failed for ${pathname}: ${lastError}`);
    }
  }

  const token = (process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '').trim();
  const url = `https://api.github.com${pathname}`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'turingos-wild-oss-scan',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token.length > 0) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${pathname} failed: ${res.status} ${res.statusText} :: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

function parseRepoName(fullName: string): { owner: string; repo: string } {
  const [owner, repo] = fullName.split('/');
  if (!owner || !repo) {
    throw new Error(`Invalid repo full name: ${fullName}`);
  }
  return { owner, repo };
}

function issueReproSignals(issue: IssueItem): string[] {
  const hay = `${issue.title}\n${issue.body ?? ''}`.toLowerCase();
  const signals: string[] = [];
  if (/repro|reproduce|steps to reproduce|minimal repro/.test(hay)) {
    signals.push('has_repro_steps');
  }
  if (/expected|actual|observed/.test(hay)) {
    signals.push('has_expected_actual');
  }
  if (/error|exception|stack|traceback|failing test|fails on/.test(hay)) {
    signals.push('has_failure_signal');
  }
  if (/version|environment|os:|node|python/.test(hay)) {
    signals.push('has_env_details');
  }
  if (issue.comments > 0) {
    signals.push('has_discussion');
  }
  return signals;
}

function scoreIssue(issue: IssueItem): number {
  const signals = issueReproSignals(issue);
  const has = (name: string): boolean => signals.includes(name);
  let s = 0;
  s += has('has_repro_steps') ? 0.35 : 0;
  s += has('has_expected_actual') ? 0.2 : 0;
  s += has('has_failure_signal') ? 0.2 : 0;
  s += has('has_env_details') ? 0.1 : 0;
  s += has('has_discussion') ? 0.15 : 0;
  return clamp01(s);
}

function scoreRow(input: {
  repo: SearchRepoItem;
  workflowCount: number;
  issueScore: number;
  selectedIssue: IssueItem | null;
}): RepoScoreBreakdown {
  const days = daysSince(input.repo.pushed_at);

  const reproducibility = input.issueScore;

  const ciVerifiability = clamp01(input.workflowCount === 0 ? 0 : 0.2 + Math.min(0.7, Math.sqrt(input.workflowCount) * 0.12));

  const entropyStars = clamp01(Math.log10(Math.max(10, input.repo.stargazers_count)) / 6);
  const entropySize = clamp01(Math.log10(Math.max(10, input.repo.size)) / 6);
  const entropyIssues = clamp01(Math.log10(Math.max(10, input.repo.open_issues_count + 1)) / 5);
  const systemEntropy = clamp01(entropyStars + entropySize + entropyIssues);

  const activityHealth = clamp01(1 - days / 45);

  const issueBodyLen = (input.selectedIssue?.body ?? '').length;
  const toolchainFriction = clamp01(
    (issueBodyLen > 1200 ? 0.3 : issueBodyLen > 400 ? 0.2 : 0.1) +
      (input.repo.language && ['TypeScript', 'JavaScript', 'Python', 'Go', 'Rust'].includes(input.repo.language)
        ? 0.25
        : 0.15) +
      (input.repo.open_issues_count > 40 ? 0.2 : 0.1)
  );

  return {
    reproducibility,
    ciVerifiability,
    systemEntropy,
    activityHealth,
    toolchainFriction,
  };
}

function weightedTotal(score: RepoScoreBreakdown): number {
  const w = {
    reproducibility: 0.3,
    ciVerifiability: 0.25,
    systemEntropy: 0.2,
    activityHealth: 0.15,
    toolchainFriction: 0.1,
  };
  return Number(
    (
      score.reproducibility * w.reproducibility +
      score.ciVerifiability * w.ciVerifiability +
      score.systemEntropy * w.systemEntropy +
      score.activityHealth * w.activityHealth +
      score.toolchainFriction * w.toolchainFriction
    ).toFixed(4)
  );
}

function toMarkdown(report: CandidatePoolReport, jsonPath: string): string {
  return [
    '# Wild OSS Shortlist',
    '',
    `- generated_at: ${report.generatedAt}`,
    `- report_json: ${jsonPath}`,
    `- recency_days: ${report.policy.recencyDays}`,
    `- min_stars: ${report.policy.minStars}`,
    `- max_stars: ${report.policy.maxStars}`,
    `- max_size_kb: ${report.policy.maxSizeKb}`,
    `- max_per_language: ${report.policy.maxPerLanguage}`,
    `- max_repo_checks: ${report.policy.maxRepoChecks}`,
    `- top_k: ${report.policy.topK}`,
    '',
    '| Rank | Repo | Lang | Stars | Days Since Push | Score | Issue |',
    '|---:|---|---|---:|---:|---:|---|',
    ...report.shortlist.map((row, idx) => {
      const issue = row.selectedIssue ? `#${row.selectedIssue.number}` : '(none)';
      return `| ${idx + 1} | ${row.fullName} | ${row.language} | ${row.stars} | ${row.daysSincePush} | ${row.weightedTotal} | ${issue} |`;
    }),
    '',
    '## Notes',
    '- Filtering is hard-gated by recency, non-archived, non-fork, and open bug issue evidence.',
    '- Final preflight should still verify clone/install/test before dispatching longrun.',
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  await fs.mkdir(AUDIT_DIR, { recursive: true });
  await fs.mkdir(HANDOVER_DIR, { recursive: true });

  const recencyDays = 30;
  const minStars = 1_000;
  const maxStars = 25_000;
  const maxSizeKb = 350_000;
  const maxPerLanguage = 3;
  const maxRepoChecks = 48;
  const topK = 10;
  const pushedAfter = daysAgoIso(recencyDays);

  const queries = [
    `language:TypeScript archived:false fork:false stars:${minStars}..${maxStars} size:100..${maxSizeKb} pushed:>=${pushedAfter}`,
    `language:Python archived:false fork:false stars:${minStars}..${maxStars} size:100..${maxSizeKb} pushed:>=${pushedAfter}`,
    `language:Go archived:false fork:false stars:${minStars}..${maxStars} size:100..${maxSizeKb} pushed:>=${pushedAfter}`,
    `language:Rust archived:false fork:false stars:${minStars}..${maxStars} size:100..${maxSizeKb} pushed:>=${pushedAfter}`,
  ];

  const repoMap = new Map<string, SearchRepoItem>();
  for (const q of queries) {
    const encoded = encodeURIComponent(q);
    for (let page = 1; page <= 2; page += 1) {
      let resp: { items: SearchRepoItem[] };
      try {
        resp = await githubRequest<{ items: SearchRepoItem[] }>(
          `/search/repositories?q=${encoded}&sort=updated&order=desc&per_page=30&page=${page}`
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[wild-oss-scan] warning: query failed q=${q} page=${page} reason=${message}`);
        continue;
      }
      for (const item of resp.items ?? []) {
        if (item.archived || item.fork) continue;
        if (item.stargazers_count > maxStars) continue;
        if (item.size > maxSizeKb) continue;
        if (!repoMap.has(item.full_name)) {
          repoMap.set(item.full_name, item);
        }
      }
    }
  }

  const repoCandidates = [...repoMap.values()].sort((a, b) => {
    const daysDiff = daysSince(a.pushed_at) - daysSince(b.pushed_at);
    if (daysDiff !== 0) return daysDiff;
    return b.stargazers_count - a.stargazers_count;
  });

  const candidates: CandidateRow[] = [];
  for (let i = 0; i < repoCandidates.length && i < maxRepoChecks; i += 1) {
    const repo = repoCandidates[i];
    if (i > 0 && i % 10 === 0) {
      console.log(`[wild-oss-scan] progress checked=${i}/${Math.min(repoCandidates.length, maxRepoChecks)}`);
    }
    const rejectReasons: string[] = [];
    const { owner, repo: repoName } = parseRepoName(repo.full_name);
    let workflow: WorkflowList = { total_count: 0 };
    let issues: IssueItem[] = [];
    try {
      workflow = await githubRequest<WorkflowList>(`/repos/${owner}/${repoName}/actions/workflows?per_page=1`);
      issues = await githubRequest<IssueItem[]>(`/repos/${owner}/${repoName}/issues?state=open&labels=bug&per_page=20`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      rejectReasons.push(`api_error:${message.slice(0, 80)}`);
    }
    const bugIssues = issues.filter((it) => !it.pull_request);

    let selectedIssue: IssueItem | null = null;
    let issueScore = 0;
    for (const issue of bugIssues) {
      const s = scoreIssue(issue);
      if (!selectedIssue || s > issueScore) {
        selectedIssue = issue;
        issueScore = s;
      }
    }

    if (workflow.total_count <= 0) {
      rejectReasons.push('missing_ci_workflow');
    }
    if (!selectedIssue) {
      rejectReasons.push('no_open_bug_issue');
    }
    if (issueScore < 0.45) {
      rejectReasons.push('weak_issue_repro_signal');
    }

    const score = scoreRow({
      repo,
      workflowCount: workflow.total_count,
      issueScore,
      selectedIssue,
    });
    const total = weightedTotal(score);

    const row: CandidateRow = {
      fullName: repo.full_name,
      htmlUrl: repo.html_url,
      language: repo.language ?? 'Unknown',
      stars: repo.stargazers_count,
      pushedAt: repo.pushed_at,
      daysSincePush: daysSince(repo.pushed_at),
      openIssuesCount: repo.open_issues_count,
      sizeKb: repo.size,
      workflowCount: workflow.total_count,
      selectedIssue: selectedIssue
        ? {
            number: selectedIssue.number,
            title: selectedIssue.title,
            htmlUrl: selectedIssue.html_url,
            comments: selectedIssue.comments,
            labels: selectedIssue.labels.map((l) => l.name),
            bodyPreview: (selectedIssue.body ?? '').replace(/\s+/g, ' ').slice(0, 240),
            reproducibilitySignals: issueReproSignals(selectedIssue),
          }
        : null,
      score,
      weightedTotal: total,
      rejectReasons,
    };

    candidates.push(row);
  }

  const scored = candidates
    .filter((row) => row.rejectReasons.length === 0)
    .sort((a, b) => b.weightedTotal - a.weightedTotal || b.stars - a.stars);
  const perLanguageCount = new Map<string, number>();
  const shortlisted: CandidateRow[] = [];
  for (const row of scored) {
    if (shortlisted.length >= topK) {
      break;
    }
    const current = perLanguageCount.get(row.language) ?? 0;
    if (current >= maxPerLanguage) {
      continue;
    }
    perLanguageCount.set(row.language, current + 1);
    shortlisted.push(row);
  }

  const stamp = timestamp();
  const report: CandidatePoolReport = {
    stamp,
    generatedAt: new Date().toISOString(),
    policy: {
      recencyDays,
      minStars,
      maxStars,
      maxSizeKb,
      maxPerLanguage,
      maxRepoChecks,
      topK,
      weights: {
        reproducibility: 0.3,
        ciVerifiability: 0.25,
        systemEntropy: 0.2,
        activityHealth: 0.15,
        toolchainFriction: 0.1,
      },
      queries,
    },
    summary: {
      fetchedRepos: repoMap.size,
      scoredRepos: scored.length,
      shortlisted: shortlisted.length,
    },
    rows: scored,
    shortlist: shortlisted,
  };

  const jsonPath = path.join(AUDIT_DIR, `wild_oss_candidate_pool_${stamp}.json`);
  const mdPath = path.join(AUDIT_DIR, `wild_oss_shortlist_${stamp}.md`);
  const latestJson = path.join(AUDIT_DIR, 'wild_oss_candidate_pool_latest.json');
  const latestMd = path.join(AUDIT_DIR, 'wild_oss_shortlist_latest.md');

  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fs.writeFile(mdPath, `${toMarkdown(report, jsonPath)}\n`, 'utf-8');
  await fs.writeFile(latestJson, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fs.writeFile(latestMd, `${toMarkdown(report, jsonPath)}\n`, 'utf-8');

  const handoverPool = path.join(HANDOVER_DIR, 'wild_oss_candidate_pool.json');
  const handoverShort = path.join(HANDOVER_DIR, 'wild_oss_shortlist.md');
  const handoverRationale = path.join(HANDOVER_DIR, 'wild_oss_selection_rationale.md');

  await fs.writeFile(handoverPool, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fs.writeFile(handoverShort, `${toMarkdown(report, jsonPath)}\n`, 'utf-8');
  await fs.writeFile(
    handoverRationale,
    [
      '# Wild OSS Selection Rationale',
      '',
      '## Scoring Policy',
      '- reproducibility: 30%',
      '- ci_verifiability: 25%',
      '- system_entropy: 20%',
      '- activity_health: 15%',
      '- toolchain_friction: 10%',
      '',
      '## Hard Gates',
      `- pushed within ${recencyDays} days`,
      '- archived=false',
      '- fork=false',
      `- stars in range ${minStars}..${maxStars}`,
      `- size_kb <= ${maxSizeKb}`,
      `- max ${maxPerLanguage} repos per language in shortlist`,
      `- max detail checks per run: ${maxRepoChecks}`,
      '- at least one CI workflow',
      '- at least one open bug issue with reproducibility score >= 0.45',
      '',
      '## Output',
      `- candidate_pool: ${path.relative(ROOT, handoverPool)}`,
      `- shortlist: ${path.relative(ROOT, handoverShort)}`,
      '',
      '## Next',
      '- Run preflight clone/install/test on top 3 before dispatching 150+ tick longrun.',
      '',
    ].join('\n'),
    'utf-8'
  );

  console.log(`[wild-oss-scan] fetched=${report.summary.fetchedRepos} scored=${report.summary.scoredRepos} shortlisted=${report.summary.shortlisted}`);
  console.log(`[wild-oss-scan] output=${jsonPath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[wild-oss-scan] fatal: ${message}`);
  process.exitCode = 1;
});
