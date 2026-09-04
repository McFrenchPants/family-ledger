#!/usr/bin/env node
/**
 * generate-task-packet.mjs
 *
 * Generates a task packet (docs/sdlc/schemas/task-packet.schema.json) from a
 * task ID plus the free-text implementation-plan entry for it (and, optionally,
 * a design-spec excerpt). Part of the sdlc-supervisor framework.
 *
 * USAGE
 *   node scripts/sdlc/generate-task-packet.mjs \
 *     --task-id SS0.3 \
 *     --plan-entry-file <path to a .txt/.md file containing the plan entry> \
 *     [--design-excerpt-file <path>] \
 *     [--dependencies SS0.1,SS0.2] \
 *     [--out .sdlc/task-packets/SS0.3.packet.json]
 *
 * Input is file-based (not inline CLI text) deliberately: plan entries and
 * design excerpts are multi-paragraph and easy to mangle passing through a
 * shell's argv/quoting. --plan-entry-file is required; --design-excerpt-file
 * is optional and, when given, is concatenated onto the plan entry before
 * inference and folded into `objective`.
 *
 * OUTPUT
 *   .sdlc/task-packets/<task-id>.packet.json (or --out to override the path),
 *   a single JSON object matching docs/sdlc/schemas/task-packet.schema.json.
 *   JSON, not YAML, is used on purpose -- it's directly validatable without a
 *   YAML-parse step, and this script assumes no YAML parser dependency is
 *   available in the target project.
 *
 * ============================================================================
 * THE read_paths / write_paths HEURISTIC -- READ THIS BEFORE TRUSTING OUTPUT
 * ============================================================================
 * This is a cheap, honest heuristic, not a code-aware tool. It does NOT parse
 * the codebase, does NOT resolve imports, and does NOT understand what a task
 * actually touches. It only looks at the INPUT TEXT you hand it. Concretely:
 *
 *   1. Explicit path-looking tokens already present in the input text are
 *      extracted via regex: things like `src/routes/lyrics.ts`,
 *      `docs/TESTING.md`, `.sdlc/state.json`, or a bare filename with a known
 *      extension. These are the highest-confidence hits because the plan
 *      author typed them.
 *   2. Bare filenames with no directory (e.g. `queue.ts` mentioned in prose)
 *      are resolved against KNOWN_DIRS below by checking which of those
 *      directories the file actually exists in ON DISK at generation time.
 *      If it exists in more than one, all matches are included (ambiguous is
 *      surfaced, not silently guessed). If it exists in none of them, the
 *      bare filename is kept as a low-confidence hit rather than dropped.
 *   3. Free-standing directory mentions (e.g. "the routes directory", a
 *      literal `src/routes/` path fragment) are kept as glob roots
 *      (`src/routes/**`) when they match a KNOWN_DIRS entry.
 *   4. `read_paths` is seeded from every hit found this way plus a few
 *      always-useful reads (docs/TESTING.md, CLAUDE.md) when the task text
 *      suggests any code change is involved (i.e. any hit at all was found).
 *      `write_paths` is seeded from hits that look like they're being
 *      created/added/modified/edited (a same-sentence heuristic: the token
 *      is within ~60 characters of a verb in WRITE_VERBS) -- everything else
 *      inferred is treated as read-only context.
 *   5. If NEITHER list ends up with anything, both arrays get the single
 *      literal placeholder entry "NEEDS_MANUAL_REVIEW" instead of being
 *      left empty. A packet containing that placeholder is not ready to
 *      hand to an implementer.
 *
 * KNOWN_DIRS below ships with generic placeholder defaults -- edit it for
 * your project's actual source layout right after init. This is the single
 * highest-value customization for making generated packets useful; without
 * it, every bare-filename mention falls back to a low-confidence hit.
 *
 * KNOWN LIMITATIONS (stated honestly, not oversold):
 *   - No semantic understanding: "the lyrics feature" will NOT resolve to
 *     src/lyrics/ unless the text also names a file/dir explicitly or the
 *     word matches something in KNOWN_DIRS' basenames.
 *   - No import-graph awareness: a task that touches app.ts to register a
 *     new route will not automatically infer the route file it registers,
 *     unless that file is also named in the text.
 *   - The write-vs-read split (step 4) is a crude proximity check on a fixed
 *     verb list, not a parse -- it will misclassify unusual phrasing.
 *   - This is a starting point for a human/orchestrator to correct, not a
 *     guarantee of a correct scope contract. Always review generated
 *     read_paths/write_paths before treating a packet as ready.
 * ============================================================================
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Assumes this script lives at <repo>/scripts/sdlc/generate-task-packet.mjs
const REPO_ROOT = path.resolve(__dirname, "..", "..");

function parseArgs(argv) {
  const args = { dependencies: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--task-id") args.taskId = argv[++i];
    else if (a === "--plan-entry-file") args.planEntryFile = argv[++i];
    else if (a === "--design-excerpt-file") args.designExcerptFile = argv[++i];
    else if (a === "--dependencies") {
      args.dependencies = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a === "--out") args.out = argv[++i];
    else if (a === "--max-attempts") args.maxAttempts = parseInt(argv[++i], 10);
    else {
      throw new Error(`Unrecognized argument: ${a}`);
    }
  }
  if (!args.taskId) throw new Error("--task-id is required");
  if (!args.planEntryFile) throw new Error("--plan-entry-file is required");
  return args;
}

// Known repo directories a bare filename or fragment can resolve against.
// CUSTOMIZE THIS LIST for your project's real layout right after init --
// generic placeholder defaults below cover a fairly common src/-based layout
// but will miss anything project-specific. Order matters only for the
// ambiguous-match report, not for correctness.
// Customized for Family Ledger's real layout (see docs/ARCHITECTURE.md S5).
// Feature-first React app under src/, Supabase migrations/functions under
// supabase/, tests under tests/. Keep this in sync when the layout changes --
// bare-filename resolution in generated packets depends on it.
const KNOWN_DIRS = [
  "src",
  "src/app",
  "src/components",
  "src/features",
  "src/features/auth",
  "src/features/household",
  "src/features/ledger",
  "src/features/payments",
  "src/features/payment-plans",
  "src/features/notifications",
  "src/features/settings",
  "src/lib",
  "src/pages",
  "src/types",
  "supabase",
  "supabase/migrations",
  "supabase/functions",
  "tests",
  "public",
  "docs",
  "docs/proposals",
  "docs/sdlc",
  "docs/sdlc/schemas",
  "scripts",
  "scripts/sdlc",
  ".sdlc",
];

const WRITE_VERBS = [
  "add",
  "adds",
  "adding",
  "create",
  "creates",
  "creating",
  "write",
  "writes",
  "writing",
  "modify",
  "modifies",
  "modifying",
  "edit",
  "edits",
  "editing",
  "update",
  "updates",
  "updating",
  "implement",
  "implements",
  "implementing",
  "emit",
  "emits",
  "emitting",
  "generate",
  "generates",
  "generating",
];

// Matches explicit repo-relative-looking paths, e.g. src/routes/lyrics.ts,
// docs/TESTING.md, .sdlc/state.json, scripts/sdlc/validate-state.mjs
const PATH_TOKEN_RE = /\b(?:\.?[A-Za-z0-9_-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9]+\b/g;
// Matches bare filenames with a known extension and no directory, e.g. nowPlaying.ts
const BARE_FILE_RE = /\b[A-Za-z0-9_-]+\.(ts|tsx|js|jsx|mjs|py|go|rb|java|json|md|yaml|yml)\b/g;

function extractPathHits(text) {
  const hits = new Map(); // token -> { index: first match offset }
  const explicitSpans = []; // [start, end) of every explicit-path match, so a
  // bare-file match that's really just a substring of an already-captured
  // explicit path (e.g. "app.ts" inside "src/app.ts", or "test.ts"
  // inside "queue.test.ts") doesn't also get added as a separate, wrong hit.
  let m;
  PATH_TOKEN_RE.lastIndex = 0;
  while ((m = PATH_TOKEN_RE.exec(text))) {
    hits.set(m[0].replace(/^\.\//, ""), { index: m.index, kind: "explicit-path" });
    explicitSpans.push([m.index, m.index + m[0].length]);
  }
  BARE_FILE_RE.lastIndex = 0;
  while ((m = BARE_FILE_RE.exec(text))) {
    const start = m.index;
    const end = m.index + m[0].length;
    const overlapsExplicit = explicitSpans.some(([s, e]) => start >= s && end <= e);
    if (overlapsExplicit) continue;
    if (!hits.has(m[0])) hits.set(m[0], { index: m.index, kind: "bare-file" });
  }
  return hits;
}

function resolveBareFile(filename) {
  const matches = [];
  for (const dir of KNOWN_DIRS) {
    const candidate = path.join(REPO_ROOT, dir, filename);
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      matches.push(`${dir}/${filename}`);
    }
  }
  return matches;
}

function isNearWriteVerb(text, index) {
  const windowStart = Math.max(0, index - 60);
  const window = text.slice(windowStart, index).toLowerCase();
  return WRITE_VERBS.some((v) => window.includes(v));
}

function inferPaths(text) {
  const hits = extractPathHits(text);
  const readPaths = new Set();
  const writePaths = new Set();

  for (const [token, info] of hits.entries()) {
    let resolved = [token];
    if (info.kind === "bare-file") {
      const dirMatches = resolveBareFile(token);
      resolved = dirMatches.length > 0 ? dirMatches : [token]; // low-confidence fallback: keep bare name
    }
    const nearWrite = isNearWriteVerb(text, info.index);
    for (const p of resolved) {
      readPaths.add(p);
      if (nearWrite) writePaths.add(p);
    }
  }

  // Directory-fragment mentions, e.g. "src/routes/" or "the routes/ dir"
  for (const dir of KNOWN_DIRS) {
    const dirRe = new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/(?![\\w.-]*\\.[A-Za-z0-9]+)", "g");
    let m;
    while ((m = dirRe.exec(text))) {
      const glob = `${dir}/**`;
      readPaths.add(glob);
      if (isNearWriteVerb(text, m.index)) writePaths.add(glob);
    }
  }

  const anyHits = readPaths.size > 0;
  if (anyHits) {
    readPaths.add("docs/TESTING.md");
    readPaths.add("CLAUDE.md");
  }

  if (readPaths.size === 0 && writePaths.size === 0) {
    return { readPaths: ["NEEDS_MANUAL_REVIEW"], writePaths: ["NEEDS_MANUAL_REVIEW"] };
  }
  return {
    readPaths: Array.from(readPaths).sort(),
    writePaths: Array.from(writePaths).sort(),
  };
}

function extractAcceptanceCriteria(text) {
  const criteria = [];
  const lines = text.split(/\r?\n/);
  let inSection = false;
  let lastWasBullet = false;
  for (const line of lines) {
    if (!inSection) {
      // Header line, markdown-bold-tolerant, e.g. "**Acceptance criteria**:"
      // or a plain "Acceptance criteria:". Only the header itself is
      // matched here; any inline text after it is intentionally NOT
      // captured (too easy to grab a stray "**:" fragment from the closing
      // bold marker) -- real criteria are expected as the bullets below it.
      if (/\*{0,2}acceptance criteri[a-z]*\*{0,2}\s*:?\s*$/i.test(line.trim())) {
        inSection = true;
      }
      continue;
    }
    const trimmed = line.trim();
    if (trimmed === "") {
      lastWasBullet = false;
      continue; // tolerate blank lines between header and bullets
    }
    const bullet = trimmed.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      criteria.push(bullet[1].trim());
      lastWasBullet = true;
    } else if (lastWasBullet && !/:\s*$/.test(trimmed) && !trimmed.startsWith("```")) {
      // Treated as a wrapped continuation of the previous bullet (plan
      // entries sometimes hard-wrap a bullet across lines without
      // re-indenting or re-marking it) rather than a new section.
      criteria[criteria.length - 1] = `${criteria[criteria.length - 1]} ${trimmed}`;
    } else {
      // A label-like line (ends with ':'), a code fence, or plain non-bullet
      // content after a non-bullet line ends the section -- deliberately
      // conservative so this doesn't vacuum up unrelated text.
      break;
    }
  }
  return criteria;
}

function extractVerificationCommands(text) {
  const commands = new Set();
  const codeBlockRe = /```(?:bash|sh)?\n([\s\S]*?)```/g;
  let m;
  while ((m = codeBlockRe.exec(text))) {
    for (const line of m[1].split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) commands.add(trimmed);
    }
  }
  const inlineRe = /`(npx [^`]+|npm run [^`]+|node [^`]+|pytest[^`]*|go test[^`]*|cargo test[^`]*)`/g;
  while ((m = inlineRe.exec(text))) {
    commands.add(m[1].trim());
  }
  return Array.from(commands);
}

function getPlanRevision(planEntryFile) {
  try {
    const abs = path.resolve(planEntryFile);
    const status = execSync(`git status --porcelain -- "${abs}"`, { cwd: REPO_ROOT }).toString().trim();
    if (status) {
      return `uncommitted:${new Date().toISOString()}`;
    }
    const sha = execSync(`git log -n 1 --format=%h -- "${abs}"`, { cwd: REPO_ROOT }).toString().trim();
    if (sha) return sha;
  } catch {
    // git not available, file not tracked, or outside a repo -- fall through
  }
  return `uncommitted:${new Date().toISOString()}`;
}

function getMaxAttempts(explicit) {
  if (Number.isInteger(explicit) && explicit > 0) return explicit;
  const DEFAULT_MAX_ATTEMPTS = 3; // fallback if project.yaml is unreadable/unparseable
  try {
    const projectYaml = readFileSync(path.join(REPO_ROOT, ".sdlc", "project.yaml"), "utf8");
    // Deliberately not a full YAML parse (no YAML dependency assumed in the
    // target project) -- just pulls the one scalar field via regex.
    const m = projectYaml.match(/max_attempts_per_task:\s*(\d+)/);
    if (m) return parseInt(m[1], 10);
  } catch {
    // fall through to default
  }
  return DEFAULT_MAX_ATTEMPTS;
}

function getAlwaysForbiddenPaths() {
  const defaults = [".sdlc/state.json", ".sdlc/project.yaml"];
  try {
    const projectYaml = readFileSync(path.join(REPO_ROOT, ".sdlc", "project.yaml"), "utf8");
    const lines = projectYaml.split(/\r?\n/);
    const start = lines.findIndex((l) => /^always_forbidden_paths:\s*(\[.*\])?\s*(#.*)?$/.test(l));
    if (start === -1) return defaults;
    const inline = lines[start].match(/^always_forbidden_paths:\s*\[(.*)\]\s*(#.*)?$/);
    if (inline) {
      const parsed = inline[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      return [...new Set([...defaults, ...parsed])];
    }
    const listed = [];
    for (let i = start + 1; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*(#.*)?$/.test(line)) continue;
      if (!/^\s/.test(line)) break;
      const m = line.match(/^\s*-\s*(.+?)\s*(#.*)?$/);
      if (m) listed.push(m[1].trim().replace(/^["']|["']$/g, ""));
    }
    return [...new Set([...defaults, ...listed])];
  } catch {
    return defaults;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const planEntry = readFileSync(path.resolve(args.planEntryFile), "utf8");
  const designExcerpt = args.designExcerptFile
    ? readFileSync(path.resolve(args.designExcerptFile), "utf8")
    : "";
  const combinedText = designExcerpt ? `${planEntry}\n\n${designExcerpt}` : planEntry;

  const { readPaths, writePaths } = inferPaths(combinedText);
  const acceptanceCriteria = extractAcceptanceCriteria(combinedText);
  const verificationCommands = extractVerificationCommands(combinedText);

  // objective: first non-empty, non-heading paragraph-ish chunk of the plan
  // entry text. Cheap and literal on purpose -- this is meant to be read and
  // corrected by a human/orchestrator, not to be a polished auto-summary.
  const firstParagraph = planEntry
    .split(/\r?\n\r?\n/)
    .map((p) => p.trim())
    .find((p) => p && !/^#/.test(p));
  const objective = (firstParagraph || planEntry.trim().split(/\r?\n/)[0] || "").trim();

  const packet = {
    task_id: args.taskId,
    plan_revision: getPlanRevision(args.planEntryFile),
    objective,
    non_goals: [],
    dependencies: args.dependencies,
    read_paths: readPaths,
    write_paths: writePaths,
    forbidden_paths: [...getAlwaysForbiddenPaths(), "docs/sdlc/IMPLEMENTATION_PLAN.md", "docs/sdlc/PROGRESS.md"],
    acceptance_criteria: acceptanceCriteria,
    verification_commands: verificationCommands,
    expected_report: "docs/sdlc/schemas/completion-report.schema.json",
    max_attempts: getMaxAttempts(args.maxAttempts),
  };

  const outPath = args.out
    ? path.resolve(args.out)
    : path.join(REPO_ROOT, ".sdlc", "task-packets", `${args.taskId}.packet.json`);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(packet, null, 2) + "\n", "utf8");

  console.log(`Wrote task packet: ${path.relative(REPO_ROOT, outPath)}`);
  if (readPaths.includes("NEEDS_MANUAL_REVIEW") || writePaths.includes("NEEDS_MANUAL_REVIEW")) {
    console.warn(
      "WARNING: no concrete paths could be inferred from the input text -- read_paths/write_paths " +
        "contain the NEEDS_MANUAL_REVIEW placeholder and this packet is not ready to hand to an implementer."
    );
  }
}

main();
