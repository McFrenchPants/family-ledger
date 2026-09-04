#!/usr/bin/env node
/**
 * scripts/sdlc/validate-state.mjs
 *
 * SS0.2 -- state-transition validator for the sdlc-supervisor framework.
 *
 * Checks two things about a proposed lifecycle_state change:
 *
 *   1. Legality: the move from one lifecycle_state to another must be a
 *      single forward step through the fixed enum (see LIFECYCLE_STATES
 *      below), matching docs/sdlc/schemas/state.schema.json's
 *      `$defs.lifecycle_state` enum and design-spec.md §5. No skipping
 *      states, no going backwards.
 *
 *        draft -> design_review -> approved -> implementing -> verifying
 *              -> ready_to_release -> released
 *
 *      `null` (the schema's "not yet in the formal pipeline" value) is
 *      treated as the state *before* draft. null -> draft is therefore a
 *      legal first step into the pipeline; anything -> null is never legal
 *      (a task cannot leave the pipeline once it has entered it) except the
 *      trivial null -> null no-op.
 *
 *      Same-state "no-op" transitions (X -> X, including null -> null) are
 *      explicitly ALLOWED by this validator -- re-saving state.json with a
 *      task's lifecycle_state unchanged is not an error. This is a
 *      deliberate judgment call: the orchestrator writes state.json on
 *      every save (see state.schema.json's `updated_at` doc comment), and
 *      most of those saves will not be moving every task forward.
 *
 *   2. Evidence gating: a transition INTO `ready_to_release` or `released`
 *      additionally requires at least one evidence file for that task to
 *      already exist on disk. Both terminal-ish states are gated (not just
 *      `released`) because `ready_to_release` is the state that asserts
 *      "verification is done, this is ready to ship" -- the evidence should
 *      exist by the time a task claims that, not only once it's released.
 *      A no-op transition INTO one of those states (X -> X where X is
 *      ready_to_release/released) is still evidence-checked, since the
 *      claim "this task is in state X" should always be backed by evidence
 *      once X is one of the gated states.
 *
 *      Evidence-file naming convention (SS0.3's task-packet/report
 *      generator MUST follow this so this validator can find its output):
 *      a task's evidence lives under `.sdlc/evidence/` as one or more files
 *      whose basename starts with `<task-id>-` or is exactly `<task-id>`
 *      (e.g. `.sdlc/evidence/SS0.1-verification.md`,
 *      `.sdlc/evidence/SS0.1.json`). The check is non-recursive: it only
 *      looks at files directly inside the evidence directory. Any file
 *      count >= 1 matching that pattern satisfies the gate; this validator
 *      does not inspect file contents or attempt to parse a
 *      `verification_commands` list (that structure is SS0.3's job).
 *
 * -------------------------------------------------------------------------
 * Library API
 * -------------------------------------------------------------------------
 *
 *   import { validateTransition } from "./validate-state.mjs";
 *
 *   const result = validateTransition("SS0.1", "approved", "implementing", {
 *     evidenceDir: ".sdlc/evidence",
 *   });
 *   // => { ok: true }
 *   // or => { ok: false, reason: "..." }
 *
 * `evidenceDir` is optional and defaults to `.sdlc/evidence` resolved
 * relative to the current working directory.
 *
 * -------------------------------------------------------------------------
 * CLI usage
 * -------------------------------------------------------------------------
 *
 *   node scripts/sdlc/validate-state.mjs <before-state.json> <after-state.json> [--evidence-dir <dir>]
 *
 * Walks every task in every work_item of both state files (matched by
 * task id) and validates each one's lifecycle_state transition from
 * <before> to <after> (a task present only in <after> is treated as
 * transitioning from null). Also validates each work_item's own top-level
 * lifecycle_state transition the same way. Prints one PASS/FAIL line per
 * check; exits 0 if every check passes, 1 otherwise.
 *
 * Self-test:
 *
 *   node scripts/sdlc/validate-state.mjs --self-test
 *
 * Runs the in-process assertions described in the SS0.2 acceptance
 * criteria (no state.json files or CLI args needed) and exits non-zero on
 * any failure.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

export const LIFECYCLE_STATES = [
  "draft",
  "design_review",
  "approved",
  "implementing",
  "verifying",
  "ready_to_release",
  "released",
];

// States whose transition requires an evidence file to already exist for
// the task in question. See header comment for the reasoning.
export const EVIDENCE_GATED_STATES = new Set(["ready_to_release", "released"]);

const DEFAULT_EVIDENCE_DIR = ".sdlc/evidence";

function stateIndex(state) {
  if (state === null || state === undefined) return -1;
  const idx = LIFECYCLE_STATES.indexOf(state);
  if (idx === -1) {
    throw new Error(
      `Unknown lifecycle_state ${JSON.stringify(state)} -- must be one of ${JSON.stringify(
        LIFECYCLE_STATES
      )} or null`
    );
  }
  return idx;
}

/**
 * Returns true if `taskId` has at least one evidence file directly under
 * `evidenceDir`, per the naming convention documented above.
 */
export function hasEvidence(taskId, evidenceDir) {
  if (!existsSync(evidenceDir)) return false;
  let entries;
  try {
    entries = readdirSync(evidenceDir, { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some((entry) => {
    if (!entry.isFile()) return false;
    const base = entry.name;
    return base === taskId || base.startsWith(`${taskId}-`) || base.startsWith(`${taskId}.`);
  });
}

/**
 * Validate a single task's proposed lifecycle_state transition.
 *
 * @param {string} taskId
 * @param {string|null} fromState
 * @param {string|null} toState
 * @param {{ evidenceDir?: string }} [options]
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateTransition(taskId, fromState, toState, options = {}) {
  const evidenceDir = options.evidenceDir ?? DEFAULT_EVIDENCE_DIR;

  let fromIdx;
  let toIdx;
  try {
    fromIdx = stateIndex(fromState);
    toIdx = stateIndex(toState);
  } catch (err) {
    return { ok: false, reason: `[${taskId}] ${err.message}` };
  }

  // Leaving the pipeline entirely (X -> null) is never legal, except the
  // trivial null -> null no-op.
  if (toIdx === -1 && fromIdx !== -1) {
    return {
      ok: false,
      reason: `[${taskId}] illegal transition: cannot move from ${JSON.stringify(
        fromState
      )} back to null (a task cannot leave the formal pipeline once entered)`,
    };
  }

  const isNoOp = fromIdx === toIdx;
  if (!isNoOp && toIdx !== fromIdx + 1) {
    const direction = toIdx < fromIdx ? "backwards" : "skipping one or more states";
    return {
      ok: false,
      reason: `[${taskId}] illegal transition: ${JSON.stringify(fromState)} -> ${JSON.stringify(
        toState
      )} is not a single forward step (${direction}). Legal order: ${LIFECYCLE_STATES.join(" -> ")}`,
    };
  }

  if (toState !== null && EVIDENCE_GATED_STATES.has(toState)) {
    if (!hasEvidence(taskId, evidenceDir)) {
      return {
        ok: false,
        reason: `[${taskId}] transition to ${JSON.stringify(
          toState
        )} requires at least one evidence file under ${evidenceDir} named "${taskId}" or starting with "${taskId}-"/"${taskId}.", but none was found`,
      };
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printUsage() {
  console.log(
    [
      "Usage:",
      "  node scripts/sdlc/validate-state.mjs <before-state.json> <after-state.json> [--evidence-dir <dir>]",
      "  node scripts/sdlc/validate-state.mjs --self-test",
      "",
      "Validates every task's (and work_item's) lifecycle_state transition from",
      "<before-state.json> to <after-state.json> against the sdlc-supervisor",
      "lifecycle enum, and gates ready_to_release/released transitions on the",
      "presence of a matching evidence file under .sdlc/evidence/ (or",
      "--evidence-dir). Exits 0 if all transitions are legal, 1 otherwise.",
    ].join("\n")
  );
}

function loadState(filePath) {
  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw);
}

function collectTaskStates(stateDoc) {
  /** @type {Map<string, string|null>} */
  const tasks = new Map();
  /** @type {Map<string, string|null>} */
  const workItems = new Map();
  for (const workItem of stateDoc.work_items ?? []) {
    workItems.set(workItem.id, workItem.lifecycle_state ?? null);
    for (const task of workItem.tasks ?? []) {
      tasks.set(task.id, task.lifecycle_state ?? null);
    }
  }
  return { tasks, workItems };
}

function runCli(argv) {
  if (argv.includes("--self-test")) {
    runSelfTest();
    return;
  }

  if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) {
    printUsage();
    process.exit(argv.length === 0 ? 1 : 0);
  }

  const evidenceFlagIdx = argv.indexOf("--evidence-dir");
  let evidenceDir = DEFAULT_EVIDENCE_DIR;
  let positional = argv;
  if (evidenceFlagIdx !== -1) {
    evidenceDir = argv[evidenceFlagIdx + 1];
    positional = [...argv.slice(0, evidenceFlagIdx), ...argv.slice(evidenceFlagIdx + 2)];
  }

  const [beforePath, afterPath] = positional;
  if (!beforePath || !afterPath) {
    printUsage();
    process.exit(1);
  }

  const before = loadState(path.resolve(beforePath));
  const after = loadState(path.resolve(afterPath));

  const beforeCollected = collectTaskStates(before);
  const afterCollected = collectTaskStates(after);

  const results = [];

  for (const [taskId, toState] of afterCollected.tasks) {
    const fromState = beforeCollected.tasks.has(taskId) ? beforeCollected.tasks.get(taskId) : null;
    results.push({ id: taskId, kind: "task", ...validateTransition(taskId, fromState, toState, { evidenceDir }) });
  }

  for (const [workItemId, toState] of afterCollected.workItems) {
    const fromState = beforeCollected.workItems.has(workItemId)
      ? beforeCollected.workItems.get(workItemId)
      : null;
    results.push({
      id: workItemId,
      kind: "work_item",
      ...validateTransition(workItemId, fromState, toState, { evidenceDir }),
    });
  }

  let allOk = true;
  for (const result of results) {
    if (result.ok) {
      console.log(`PASS [${result.kind}] ${result.id}`);
    } else {
      allOk = false;
      console.log(`FAIL [${result.kind}] ${result.id}: ${result.reason}`);
    }
  }

  process.exit(allOk ? 0 : 1);
}

function runSelfTest() {
  const failures = [];
  const check = (name, fn) => {
    try {
      fn();
      console.log(`PASS ${name}`);
    } catch (err) {
      failures.push(name);
      console.log(`FAIL ${name}: ${err.message}`);
    }
  };

  // (a) rejects an out-of-order transition
  check("rejects draft -> implementing (skips design_review, approved)", () => {
    const result = validateTransition("T1", "draft", "implementing", { evidenceDir: DEFAULT_EVIDENCE_DIR });
    assert.equal(result.ok, false);
  });

  // (b) rejects a transition to released with no matching evidence
  const tmpDirEmpty = mkdtempSync(path.join(tmpdir(), "sdlc-evidence-empty-"));
  check("rejects verifying -> ready_to_release with no evidence file present", () => {
    const result = validateTransition("T2", "verifying", "ready_to_release", { evidenceDir: tmpDirEmpty });
    assert.equal(result.ok, false);
    assert.match(result.reason, /evidence file/);
  });
  rmSync(tmpDirEmpty, { recursive: true, force: true });

  // (c) accepts a legal single-step transition
  check("accepts draft -> design_review", () => {
    const result = validateTransition("T3", "draft", "design_review", { evidenceDir: DEFAULT_EVIDENCE_DIR });
    assert.equal(result.ok, true);
  });

  // (c-bis) accepts null -> draft (entering the pipeline)
  check("accepts null -> draft", () => {
    const result = validateTransition("T4", null, "draft", { evidenceDir: DEFAULT_EVIDENCE_DIR });
    assert.equal(result.ok, true);
  });

  // (c-ter) accepts a no-op same-state transition
  check("accepts approved -> approved (no-op)", () => {
    const result = validateTransition("T5", "approved", "approved", { evidenceDir: DEFAULT_EVIDENCE_DIR });
    assert.equal(result.ok, true);
  });

  // (d) accepts a transition to released when a matching evidence file exists
  const tmpDirWithEvidence = mkdtempSync(path.join(tmpdir(), "sdlc-evidence-present-"));
  writeFileSync(path.join(tmpDirWithEvidence, "T6-verification.md"), "evidence\n");
  check("accepts ready_to_release -> released with matching evidence present", () => {
    const result = validateTransition("T6", "ready_to_release", "released", { evidenceDir: tmpDirWithEvidence });
    assert.equal(result.ok, true);
  });
  rmSync(tmpDirWithEvidence, { recursive: true, force: true });

  // extra: rejects backwards transition
  check("rejects implementing -> approved (backwards)", () => {
    const result = validateTransition("T7", "implementing", "approved", { evidenceDir: DEFAULT_EVIDENCE_DIR });
    assert.equal(result.ok, false);
  });

  // extra: rejects leaving the pipeline (X -> null)
  check("rejects draft -> null", () => {
    const result = validateTransition("T8", "draft", null, { evidenceDir: DEFAULT_EVIDENCE_DIR });
    assert.equal(result.ok, false);
  });

  // extra: no-op into an evidence-gated state still requires evidence
  const tmpDirEmpty2 = mkdtempSync(path.join(tmpdir(), "sdlc-evidence-noop-"));
  check("rejects released -> released (no-op) with no evidence file present", () => {
    const result = validateTransition("T9", "released", "released", { evidenceDir: tmpDirEmpty2 });
    assert.equal(result.ok, false);
  });
  rmSync(tmpDirEmpty2, { recursive: true, force: true });

  console.log("");
  if (failures.length > 0) {
    console.log(`${failures.length} self-test(s) FAILED: ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log("All self-tests passed.");
  process.exit(0);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
if (isMain) {
  runCli(process.argv.slice(2));
}
