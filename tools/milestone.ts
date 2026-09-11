/**
 * The stopwatch for this exercise.
 *
 *   pnpm milestone 3          stamp milestone 3 as done, now
 *   pnpm milestone 3 "…note"  same, with a note to yourself
 *   pnpm milestone list       the ten, and which of them you have stamped
 *   pnpm milestone report     the plain-text block you send back
 *
 * The whole point of the handoff is the number this produces: how long a real
 * CRM takes to go live with Kaafil, split into setup cost and integration
 * cost. A blended figure is easy to argue with — "well, half of that was npm
 * install" — so milestones 1-4 and 5-10 are totalled separately and never
 * merged into one headline.
 *
 * It is deliberately forgiving. Stamping the same milestone twice overwrites
 * the first; stamping them out of order is allowed and simply noted; the
 * report renders fine with holes in it. Someone racing a clock will not use a
 * logbook tidily, and a tool that argues with them gets abandoned two
 * milestones in — at which point we have no data at all, which is strictly
 * worse than untidy data.
 *
 * Node built-ins only. This runs before, during and after the QA has anything
 * installed, so it must not depend on the install having worked.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOG_PATH = join(REPO_ROOT, '.milestones.json');
const TEMPLATE_PATH = join(REPO_ROOT, 'docs', '03-report-template.md');

// ---------------------------------------------------------------------------
// The ten
// ---------------------------------------------------------------------------

interface MilestoneDef {
  readonly n: number;
  readonly name: string;
  /** One line, so `list` can answer "done means what, exactly?" without docs. */
  readonly doneWhen: string;
}

/**
 * 1-4 is setup: everything you would also do for any other vendor. 5-10 is the
 * integration itself. The boundary sits after "trips in Kaafil" because that is
 * the last step you can complete without having written a line of UI code.
 */
const MILESTONES: readonly MilestoneDef[] = [
  { n: 1, name: 'cloned + installed', doneWhen: '`pnpm install` finished without errors.' },
  {
    n: 2,
    name: 'API key in .env',
    doneWhen: 'You created a key in the partner console and put it in .env.',
  },
  {
    n: 3,
    name: 'CRM running, seeded',
    doneWhen: '`pnpm dev` serves Sharma Travels Admin and its trip list has rows.',
  },
  {
    n: 4,
    name: 'trips in Kaafil',
    doneWhen: 'Boot ingest finished; the trips exist in your tenant.',
  },
  {
    n: 5,
    name: 'desk console renders',
    doneWhen: 'An /admin surface renders inside the CRM with a real agency-admin session.',
  },
  {
    n: 6,
    name: 'manager surface renders',
    doneWhen: 'A /manager surface renders with a real manager session.',
  },
  {
    n: 7,
    name: 'traveller share link opens',
    doneWhen: 'A share token opens the traveller view in a logged-out browser.',
  },
  {
    n: 8,
    name: 'branded to the CRM palette',
    doneWhen: "Kaafil looks like Sharma Travels, not like Kaafil's defaults.",
  },
  {
    n: 9,
    name: 'a slot or custom panel',
    doneWhen: 'You put your own CRM component inside a Kaafil surface.',
  },
  {
    n: 10,
    name: 'an offline write survives reload',
    doneWhen: 'A write made offline is still queued (or applied) after a page reload.',
  },
];

const SETUP_RANGE = { from: 1, to: 4 } as const;
const INTEGRATION_RANGE = { from: 5, to: 10 } as const;

const defOf = (n: number): MilestoneDef | undefined => MILESTONES.find((m) => m.n === n);

// ---------------------------------------------------------------------------
// The log
// ---------------------------------------------------------------------------

interface Entry {
  milestone: number;
  name: string;
  iso: string;
  /**
   * Seconds of new wall-clock time this milestone added — measured from the
   * latest stamp among all lower-numbered milestones. Null for the first one
   * stamped, and null where the stamps run backwards in time. See recompute().
   */
  secondsSincePrevious: number | null;
  note?: string;
  /** True when this entry's timestamp predates a lower-numbered milestone's. */
  outOfOrder?: boolean;
  /** Set when a milestone is stamped more than once, for honesty in the report. */
  restampedAt?: string[];
}

interface Log {
  version: 1;
  entries: Entry[];
}

function readLog(): Log {
  if (!existsSync(LOG_PATH)) return { version: 1, entries: [] };
  try {
    const raw = JSON.parse(readFileSync(LOG_PATH, 'utf8')) as unknown;
    if (raw && typeof raw === 'object' && Array.isArray((raw as Log).entries)) {
      const entries = (raw as Log).entries.filter(
        (e): e is Entry => !!e && typeof e.milestone === 'number' && typeof e.iso === 'string',
      );
      return { version: 1, entries };
    }
  } catch {
    // A corrupted log is not worth halting over: the timings are a nice-to-have
    // and the QA's actual work is not in this file. Start a fresh one and say so.
    process.stderr.write(
      `\n  Could not read ${LOG_PATH} — starting a fresh log.\n` +
        '  (If you want the old one, it is about to be overwritten; copy it now.)\n\n',
    );
  }
  return { version: 1, entries: [] };
}

function writeLog(log: Log): void {
  mkdirSync(dirname(LOG_PATH), { recursive: true });
  writeFileSync(LOG_PATH, `${JSON.stringify(log, null, 2)}\n`, 'utf8');
}

/**
 * Derives every `secondsSincePrevious` from scratch, in milestone order, so the
 * file is consistent no matter what order the stamps arrived in. Deriving beats
 * incrementing: a late stamp for milestone 2 has to change milestone 3's gap
 * too, and an incremental writer would leave that stale forever.
 */
function recompute(log: Log): Log {
  const entries = [...log.entries].sort((a, b) => a.milestone - b.milestone);

  // Each gap is measured from the IMMEDIATELY PRECEDING milestone, not from
  // the latest stamp seen so far.
  //
  // A high-water baseline was tried first and cascades badly. Backfill
  // milestone 1 at 12:30 after stamping 2..5 between 10:00 and 12:00 and all
  // four of those gaps go null, because each is compared against 12:30 — yet
  // 2 -> 3 is forty minutes and perfectly knowable. Reporting "—" there throws
  // away real data and collapses the range totals this whole tool exists to
  // produce.
  //
  // Measuring from the previous milestone drops only the one pair that
  // genuinely inverts. The double-counting that motivated the high-water rule
  // cannot arise, because range totals are computed from first and last stamp
  // rather than by summing gaps (see `totalFor`).
  let previousMs: number | undefined;

  for (const entry of entries) {
    entry.name = defOf(entry.milestone)?.name ?? entry.name;
    const stampedMs = Date.parse(entry.iso);

    if (previousMs === undefined || Number.isNaN(stampedMs)) {
      entry.secondsSincePrevious = null;
      entry.outOfOrder = false;
    } else {
      const delta = (stampedMs - previousMs) / 1000;
      // Negative means this milestone is stamped earlier than the one before
      // it — a backfill. That pair's ordering is unknowable, so its gap is
      // dropped rather than guessed at, and nothing after it is affected.
      entry.outOfOrder = delta < 0;
      entry.secondsSincePrevious = delta < 0 ? null : delta;
    }

    if (!Number.isNaN(stampedMs)) previousMs = stampedMs;
  }

  return { version: 1, entries };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const pad2 = (n: number): string => String(n).padStart(2, '0');

function humanize(seconds: number | null): string {
  if (seconds === null) return '—';
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${pad2(m)}m ${pad2(s)}s`;
  if (m > 0) return `${m}m ${pad2(s)}s`;
  return `${s}s`;
}

/** Local wall-clock, because a human reads this. The ISO form stays in the JSON. */
function localStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  );
}

function timezoneName(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';
  } catch {
    return 'local time';
  }
}

// ---------------------------------------------------------------------------
// Environment facts for the report
// ---------------------------------------------------------------------------

/**
 * Reads a single variable out of .env without loading dotenv and without
 * putting it on process.env. `pnpm milestone` is run WITHOUT --env-file on
 * purpose: this tool has no business holding the API key, and only ever looks
 * at the first eight characters of it.
 */
function envValue(key: string): string | undefined {
  const fromProcess = process.env[key];
  if (fromProcess) return fromProcess;

  const envPath = join(REPO_ROOT, '.env');
  if (!existsSync(envPath)) return undefined;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq).trim() !== key) continue;
    return trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  return undefined;
}

/**
 * The plane, from the key prefix alone. The key itself is never read past its
 * prefix, never stored, and never printed — this report gets pasted into a chat
 * window, which is exactly how partner credentials leak.
 */
function detectPlane(): string {
  const key = envValue('KAAFIL_API_KEY');
  if (!key || key.endsWith('replace_me')) return 'unknown (no key in .env yet)';
  if (key.startsWith('kf_test_')) return 'test (sandbox)';
  if (key.startsWith('kf_live_')) return 'live';
  return 'unknown (key prefix is neither kf_test_ nor kf_live_)';
}

function packageVersion(name: string): string {
  const installed = join(REPO_ROOT, 'node_modules', ...name.split('/'), 'package.json');
  if (existsSync(installed)) {
    try {
      const pkg = JSON.parse(readFileSync(installed, 'utf8')) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch {
      // Fall through to the declared range below.
    }
  }

  const rootPkgPath = join(REPO_ROOT, 'package.json');
  if (existsSync(rootPkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(rootPkgPath, 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const declared = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
      if (declared) return `${declared} (declared; not installed)`;
    } catch {
      // Nothing left to try.
    }
  }

  return 'not found';
}

// ---------------------------------------------------------------------------
// Debrief prompts
// ---------------------------------------------------------------------------

/**
 * The questions live in docs/03-report-template.md so the prose and the tool
 * cannot drift apart; every line there ending in a question mark becomes a
 * blank prompt here. The built-in set below is the fallback for a checkout
 * where that file has been moved or edited into something without questions —
 * an empty debrief section would look like there was nothing to answer.
 */
const FALLBACK_PROMPTS: readonly string[] = [
  'Where did you get stuck, and roughly how long did each stick cost you?',
  'Which step did you have to read Kaafil source code for, instead of docs?',
  'What did you go looking for in the docs and fail to find?',
  'Did anything in the UI Kit break, misrender, or behave unexpectedly?',
  'How far did the customization ladder bend before you had to fight it — tokens, slots, or a custom panel?',
  "Did the CRM's own CSS and Kaafil's CSS interfere, in either direction?",
  'What actually happened to the offline write on reload?',
  'Was anything about the traveller share link surprising?',
  'If you had to integrate a second CRM tomorrow, what would you want to exist that does not?',
  'Anything you would tell the Kaafil team that none of the above asked about?',
];

function debriefPrompts(): readonly string[] {
  if (!existsSync(TEMPLATE_PATH)) return FALLBACK_PROMPTS;
  try {
    const raw = readFileSync(TEMPLATE_PATH, 'utf8');

    // Blocks first, THEN look for questions. Testing raw lines for a trailing
    // "?" assumes one question per line, which markdown does not guarantee:
    // the template wraps its prose at 80 columns, so the old version sliced
    // continuation lines out of the middle of paragraphs and emitted
    // fragments like "setting a token — list them." as if they were prompts.
    //
    // A block is a run of non-blank lines that is not a heading, quote, code
    // fence or table row, joined back into the single logical line the author
    // wrote.
    const blocks: string[] = [];
    let current: string[] = [];
    let inFence = false;

    const flush = () => {
      if (current.length > 0) {
        blocks.push(current.join(' ').replace(/\s+/g, ' ').trim());
        current = [];
      }
    };

    for (const line of raw.split('\n')) {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        flush();
        continue;
      }
      if (inFence) continue;

      if (line.trim() === '' || /^\s*(#{1,6}\s|>|\||-{3,}\s*$)/.test(line)) {
        flush();
        continue;
      }
      // A new bullet or numbered item starts a new block; anything else is a
      // continuation of the one being built.
      if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) flush();
      current.push(line.replace(/^\s*(?:[-*+]|\d+[.)])\s*/, '').trim());
    }
    flush();

    const questions = blocks.filter((block) => block.endsWith('?') && block.length > 12);
    return questions.length > 0 ? questions : FALLBACK_PROMPTS;
  } catch {
    return FALLBACK_PROMPTS;
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function usage(): string {
  return [
    '',
    '  pnpm milestone <1-10> [note]   stamp a milestone as done, now',
    '  pnpm milestone list            the ten, and which you have stamped',
    '  pnpm milestone report          the plain-text block you send back',
    '',
    '  Re-stamping overwrites. Out of order is fine. Gaps are fine.',
    '',
  ].join('\n');
}

function stamp(n: number, note: string | undefined): string {
  const def = defOf(n);
  if (!def) {
    return `\n  There are ten milestones, 1 to 10 — ${n} is not one of them.\n${usage()}`;
  }

  const log = readLog();
  const iso = new Date().toISOString();
  const existing = log.entries.find((e) => e.milestone === n);
  const isRestamp = existing !== undefined;

  if (existing) {
    const history = existing.restampedAt ?? [];
    history.push(existing.iso);
    existing.restampedAt = history;
    existing.iso = iso;
    existing.name = def.name;
    if (note) existing.note = note;
  } else {
    log.entries.push({
      milestone: n,
      name: def.name,
      iso,
      secondsSincePrevious: null,
      ...(note ? { note } : {}),
    });
  }

  const next = recompute(log);
  writeLog(next);

  const stamped = next.entries.find((e) => e.milestone === n);
  const gap = stamped?.secondsSincePrevious ?? null;
  const remaining = MILESTONES.filter((m) => !next.entries.some((e) => e.milestone === m.n));

  const lines = [
    '',
    `  ${isRestamp ? 're-stamped' : 'stamped'}  ${n}. ${def.name}`,
    `  at        ${localStamp(iso)}`,
  ];
  if (gap !== null) lines.push(`  elapsed   ${humanize(gap)} since your last stamp`);
  if (stamped?.outOfOrder) {
    lines.push('  note      stamped after a higher milestone — its gap is left out of the totals');
  }
  if (note) lines.push(`  note      ${note}`);
  lines.push(
    '',
    remaining.length === 0
      ? '  All ten done. Run `pnpm milestone report` and send the output back.'
      : `  Next up: ${remaining[0]?.n}. ${remaining[0]?.name}`,
    '',
  );
  return lines.join('\n');
}

function list(): string {
  const log = recompute(readLog());
  const done = new Map(log.entries.map((e) => [e.milestone, e]));

  const lines = ['', '  THE TEN', ''];
  for (const m of MILESTONES) {
    const entry = done.get(m.n);
    const mark = entry ? '[x]' : '[ ]';
    const when = entry ? localStamp(entry.iso) : '';
    const separator = m.n === INTEGRATION_RANGE.from ? ['  ── integration ──', ''] : [];
    lines.push(...separator);
    lines.push(`  ${mark} ${String(m.n).padStart(2)}. ${m.name.padEnd(30)} ${when}`.trimEnd());
    lines.push(`          ${m.doneWhen}`);
    lines.push('');
  }
  lines.push(
    `  ${done.size} of 10 stamped.`,
    '  Milestones 1-4 are setup; 5-10 are the integration itself.',
    '',
  );
  return lines.join('\n');
}

interface RangeTotal {
  readonly seconds: number | null;
  readonly stamped: number;
  readonly size: number;
  readonly partial: boolean;
}

function totalFor(entries: readonly Entry[], from: number, to: number): RangeTotal {
  const inRange = entries.filter((e) => e.milestone >= from && e.milestone <= to);
  const size = to - from + 1;
  // ELAPSED, not the sum of the gaps: the range's own last stamp minus the
  // stamp it started from. Summing per-milestone gaps means one dropped gap
  // silently removes that time from the total, so a QA who backfilled a
  // single milestone would report a setup phase shorter than it really was —
  // and this number is the headline of the whole exercise.
  //
  // The range starts from the stamp BEFORE its first milestone where there is
  // one, so integration correctly owns the 4 -> 5 gap: that time was spent
  // writing integration code. Nothing precedes milestone 1, so setup measures
  // from its own first stamp.
  const msOf = (e: Entry) => Date.parse(e.iso);
  const stampsInRange = inRange.map(msOf).filter((ms) => !Number.isNaN(ms));

  const priorStamps = entries
    .filter((e) => e.milestone < from)
    .map(msOf)
    .filter((ms) => !Number.isNaN(ms));
  const startMs =
    priorStamps.length > 0
      ? Math.max(...priorStamps)
      : Math.min(...(stampsInRange.length > 0 ? stampsInRange : [Number.NaN]));

  const seconds =
    stampsInRange.length === 0 || Number.isNaN(startMs)
      ? null
      : Math.max(0, (Math.max(...stampsInRange) - startMs) / 1000);

  return {
    seconds,
    stamped: inRange.length,
    size,
    // Incomplete if any milestone in the range is unstamped, or if a backfill
    // means the range's own ordering cannot be trusted.
    partial: inRange.length < size || inRange.some((e) => e.outOfOrder === true),
  };
}

function report(): string {
  const log = recompute(readLog());
  // Reporting is a read, so it must not conjure a log for someone who has not
  // stamped anything — but where one exists, persisting the recomputed gaps
  // keeps the file and the printed report telling the same story.
  if (log.entries.length > 0) writeLog(log);
  const entries = log.entries;
  const byNumber = new Map(entries.map((e) => [e.milestone, e]));

  const out: string[] = [];
  const rule = '='.repeat(72);

  out.push(rule);
  out.push('KAAFIL UI KIT — QA INTEGRATION REPORT');
  out.push(rule);
  out.push('');
  out.push(`Generated   ${localStamp(new Date().toISOString())}  (${timezoneName()})`);
  out.push('');

  out.push('ENVIRONMENT');
  out.push(`  node                 ${process.version}`);
  out.push(`  kaafil-js            ${packageVersion('kaafil-js')}`);
  out.push(`  kaafil-react-uikit   ${packageVersion('kaafil-react-uikit')}`);
  out.push(`  plane                ${detectPlane()}`);
  out.push(`  platform             ${process.platform} ${process.arch}`);
  out.push('');

  out.push('MILESTONES');
  out.push('  #   milestone                        stamped at        elapsed');
  out.push(`  ${'-'.repeat(68)}`);
  for (const m of MILESTONES) {
    if (m.n === INTEGRATION_RANGE.from) {
      out.push(`  ${'-'.repeat(20)} integration ${'-'.repeat(35)}`);
    }
    const entry = byNumber.get(m.n);
    if (!entry) {
      out.push(`  ${String(m.n).padStart(2)}  ${m.name.padEnd(32)} not stamped`);
      continue;
    }
    const elapsed =
      m.n === 1 && entry.secondsSincePrevious === null
        ? 'start'
        : humanize(entry.secondsSincePrevious);
    out.push(
      `  ${String(m.n).padStart(2)}  ${m.name.padEnd(32)} ${localStamp(entry.iso).padEnd(17)} ${elapsed}`,
    );
    if (entry.note) out.push(`      note: ${entry.note}`);
  }
  out.push('');

  const setup = totalFor(entries, SETUP_RANGE.from, SETUP_RANGE.to);
  const integration = totalFor(entries, INTEGRATION_RANGE.from, INTEGRATION_RANGE.to);

  out.push('TOTALS');
  out.push('  Reported separately on purpose. Setup is the cost of any vendor;');
  out.push('  integration is the cost of this one. Blending them hides both.');
  out.push('');
  out.push(
    `  SETUP TOTAL        (1-4)    ${humanize(setup.seconds).padEnd(14)}` +
      `${setup.stamped}/${setup.size} stamped${setup.partial ? '  — partial' : ''}`,
  );
  out.push(
    `  INTEGRATION TOTAL  (5-10)   ${humanize(integration.seconds).padEnd(14)}` +
      `${integration.stamped}/${integration.size} stamped${integration.partial ? '  — partial' : ''}`,
  );

  if (entries.length >= 2) {
    const byClock = [...entries].sort((a, b) => Date.parse(a.iso) - Date.parse(b.iso));
    const earliest = byClock[0];
    const latest = byClock[byClock.length - 1];
    if (earliest && latest) {
      const wall = (Date.parse(latest.iso) - Date.parse(earliest.iso)) / 1000;
      out.push(`  WALL CLOCK  first stamp to last   ${humanize(wall)}`);
    }
  }
  out.push('');

  const notes: string[] = [];
  const missing = MILESTONES.filter((m) => !byNumber.has(m.n)).map((m) => m.n);
  if (missing.length > 0) {
    notes.push(`Never stamped: ${missing.join(', ')}. Totals above exclude them.`);
  }
  const backwards = entries.filter((e) => e.outOfOrder).map((e) => e.milestone);
  if (backwards.length > 0) {
    notes.push(
      `Stamped out of order: ${backwards.join(', ')}. Their gaps are unknowable, so they are left out of the totals.`,
    );
  }
  const restamped = entries.filter((e) => (e.restampedAt?.length ?? 0) > 0);
  for (const e of restamped) {
    notes.push(
      `Milestone ${e.milestone} was stamped ${(e.restampedAt?.length ?? 0) + 1} times; the last stamp is the one used.`,
    );
  }
  if (notes.length > 0) {
    out.push('NOTES ON THE TIMINGS');
    for (const n of notes) out.push(`  - ${n}`);
    out.push('');
  }

  out.push(rule);
  out.push('DEBRIEF — please answer under each line before sending');
  out.push(rule);
  out.push('');
  for (const prompt of debriefPrompts()) {
    out.push(prompt);
    out.push('  ');
    out.push('');
  }
  out.push(rule);
  out.push('');

  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main(): number {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(list());
    process.stdout.write(usage());
    return 0;
  }

  if (command === 'list' || command === 'ls') {
    process.stdout.write(list());
    return 0;
  }

  if (command === 'report') {
    process.stdout.write(report());
    return 0;
  }

  const n = Number.parseInt(command.replace(/^#/, ''), 10);
  if (Number.isInteger(n)) {
    const note = rest.join(' ').trim();
    process.stdout.write(stamp(n, note.length > 0 ? note : undefined));
    return defOf(n) ? 0 : 1;
  }

  process.stdout.write(`\n  Not sure what "${command}" means.\n${usage()}`);
  return 1;
}

process.exitCode = main();
