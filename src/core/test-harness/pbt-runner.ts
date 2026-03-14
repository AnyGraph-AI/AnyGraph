/**
 * Stateful PBT Runner — Property-Based Testing for Governance Workflows
 *
 * Implements action-sequence workflows + seeded PBT runner + counterexample capture.
 * Tests governance state machines by generating random sequences of valid actions
 * and checking invariants after each step.
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone X2
 */

import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ============================================================================
// TYPES
// ============================================================================

/**
 * A governance action that mutates state.
 */
export interface GovAction<TState> {
  /** Unique action type name */
  type: string;
  /** Precondition: is this action valid in the current state? */
  precondition: (state: TState) => boolean;
  /** Execute the action, returning the new state */
  execute: (state: TState, rng: SeededRNG) => TState;
  /** Human-readable description for counterexample reporting */
  describe: (state: TState) => string;
}

/**
 * An invariant that must hold after every action.
 */
export interface StateInvariant<TState> {
  /** Invariant name */
  name: string;
  /** Check: does the invariant hold? */
  check: (state: TState) => boolean;
  /** Message on failure */
  failMessage: (state: TState) => string;
}

/**
 * Result of a single PBT run.
 */
export interface PBTRunResult<TState> {
  /** Did all runs pass? */
  passed: boolean;
  /** Total runs executed */
  totalRuns: number;
  /** Total actions executed across all runs */
  totalActions: number;
  /** Counterexamples found (if any) */
  counterexamples: Counterexample<TState>[];
  /** Seed used */
  seed: string;
  /** Duration in ms */
  durationMs: number;
}

/**
 * A counterexample: a sequence of actions that violates an invariant.
 */
export interface Counterexample<TState> {
  /** The seed that produced this counterexample */
  seed: string;
  /** Run index within the batch */
  runIndex: number;
  /** Step index where the violation occurred */
  stepIndex: number;
  /** Action sequence that led to the violation */
  actionSequence: string[];
  /** Which invariant was violated */
  violatedInvariant: string;
  /** Failure message */
  failMessage: string;
  /** State at failure */
  stateAtFailure: TState;
  /** SHA-256 digest for deduplication */
  digest: string;
}

// ============================================================================
// SEEDED RNG
// ============================================================================

/**
 * Simple seeded PRNG (xorshift128+) for deterministic test generation.
 * NOT cryptographically secure — only for test generation.
 */
export class SeededRNG {
  private s0: number;
  private s1: number;

  constructor(seed: string) {
    // Hash the seed string to get initial state
    const hash = createHash('sha256').update(seed).digest();
    this.s0 = hash.readUInt32LE(0);
    this.s1 = hash.readUInt32LE(4);
    if (this.s0 === 0 && this.s1 === 0) {
      this.s0 = 1; // avoid zero state
    }
  }

  /** Returns a float in [0, 1) */
  next(): number {
    let s1 = this.s0;
    const s0 = this.s1;
    this.s0 = s0;
    s1 ^= s1 << 23;
    s1 ^= s1 >>> 17;
    s1 ^= s0;
    s1 ^= s0 >>> 26;
    this.s1 = s1;
    return ((this.s0 + this.s1) >>> 0) / 0x100000000;
  }

  /** Returns an integer in [0, max) */
  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }

  /** Pick a random element from an array */
  pick<T>(arr: T[]): T {
    return arr[this.nextInt(arr.length)];
  }

  /** Fork: create a child RNG with a derived seed */
  fork(label: string): SeededRNG {
    return new SeededRNG(`${this.s0}:${this.s1}:${label}`);
  }
}

// ============================================================================
// PBT RUNNER
// ============================================================================

export interface PBTConfig<TState> {
  /** Initial state factory */
  initialState: () => TState;
  /** Available actions */
  actions: GovAction<TState>[];
  /** Invariants to check after each action */
  invariants: StateInvariant<TState>[];
  /** Seed for reproducibility */
  seed: string;
  /** Number of runs to execute (default: 100) */
  numRuns?: number;
  /** Max actions per run (default: 20) */
  maxActionsPerRun?: number;
  /** Stop after first counterexample (default: false) */
  stopOnFirst?: boolean;
}

/**
 * Run a stateful PBT campaign.
 * Generates random action sequences, executes them, checks invariants.
 */
export function runPBT<TState>(config: PBTConfig<TState>): PBTRunResult<TState> {
  const {
    initialState,
    actions,
    invariants,
    seed,
    numRuns = 100,
    maxActionsPerRun = 20,
    stopOnFirst = false,
  } = config;

  const startTime = Date.now();
  const rng = new SeededRNG(seed);
  const counterexamples: Counterexample<TState>[] = [];
  let totalActions = 0;

  for (let runIdx = 0; runIdx < numRuns; runIdx++) {
    const runRng = rng.fork(`run_${runIdx}`);
    let state = initialState();
    const actionLog: string[] = [];
    const numActions = runRng.nextInt(maxActionsPerRun) + 1;

    for (let step = 0; step < numActions; step++) {
      // Find valid actions
      const validActions = actions.filter(a => a.precondition(state));
      if (validActions.length === 0) break;

      // Pick and execute a random valid action
      const action = runRng.pick(validActions);
      const description = action.describe(state);
      actionLog.push(`${action.type}: ${description}`);

      state = action.execute(state, runRng);
      totalActions++;

      // Check all invariants
      for (const inv of invariants) {
        if (!inv.check(state)) {
          const cx: Counterexample<TState> = {
            seed,
            runIndex: runIdx,
            stepIndex: step,
            actionSequence: [...actionLog],
            violatedInvariant: inv.name,
            failMessage: inv.failMessage(state),
            stateAtFailure: structuredClone(state),
            digest: '',
          };
          cx.digest = computeCounterexampleDigest(cx);
          counterexamples.push(cx);

          if (stopOnFirst) {
            return {
              passed: false,
              totalRuns: runIdx + 1,
              totalActions,
              counterexamples,
              seed,
              durationMs: Date.now() - startTime,
            };
          }
          break; // skip remaining invariants for this step
        }
      }

      // If we already found a counterexample this run, move to next run
      if (counterexamples.some(c => c.runIndex === runIdx)) break;
    }
  }

  return {
    passed: counterexamples.length === 0,
    totalRuns: numRuns,
    totalActions,
    counterexamples,
    seed,
    durationMs: Date.now() - startTime,
  };
}

// ============================================================================
// COUNTEREXAMPLE CAPTURE
// ============================================================================

function computeCounterexampleDigest<TState>(cx: Counterexample<TState>): string {
  const { digest: _, stateAtFailure: __, ...content } = cx;
  return createHash('sha256')
    .update(JSON.stringify(content))
    .digest('hex');
}

/**
 * Save counterexamples to disk for debugging and regression testing.
 */
export function saveCounterexamples<TState>(
  counterexamples: Counterexample<TState>[],
  dir: string = 'artifacts/counterexamples'
): string[] {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const paths: string[] = [];
  for (const cx of counterexamples) {
    const filename = `cx_${cx.digest.slice(0, 16)}.json`;
    const filepath = join(dir, filename);
    writeFileSync(filepath, JSON.stringify(cx, null, 2));
    paths.push(filepath);
  }
  return paths;
}

/**
 * Shrink a counterexample by trying to remove actions while preserving the failure.
 * Returns the minimal action sequence that still triggers the invariant violation.
 */
export function shrinkCounterexample<TState>(
  cx: Counterexample<TState>,
  config: Pick<PBTConfig<TState>, 'initialState' | 'actions' | 'invariants'>
): Counterexample<TState> {
  const { initialState, actions, invariants } = config;
  let bestSequence = cx.actionSequence;

  // Try removing each action one at a time
  for (let i = bestSequence.length - 1; i >= 0; i--) {
    const candidate = [...bestSequence.slice(0, i), ...bestSequence.slice(i + 1)];
    if (replayFailsWith(candidate, cx.violatedInvariant, initialState, actions, invariants)) {
      bestSequence = candidate;
    }
  }

  if (bestSequence.length < cx.actionSequence.length) {
    const shrunk: Counterexample<TState> = {
      ...cx,
      actionSequence: bestSequence,
      stepIndex: bestSequence.length - 1,
      digest: '',
    };
    // Re-execute to get the actual state at failure
    let state = initialState();
    const rng = new SeededRNG(cx.seed);
    for (const desc of bestSequence) {
      const actionType = desc.split(':')[0];
      const action = actions.find(a => a.type === actionType);
      if (action && action.precondition(state)) {
        state = action.execute(state, rng);
      }
    }
    shrunk.stateAtFailure = structuredClone(state);
    shrunk.digest = computeCounterexampleDigest(shrunk);
    return shrunk;
  }

  return cx;
}

function replayFailsWith<TState>(
  sequence: string[],
  invariantName: string,
  initialState: () => TState,
  actions: GovAction<TState>[],
  invariants: StateInvariant<TState>[]
): boolean {
  let state = initialState();
  const rng = new SeededRNG('shrink-replay');

  for (const desc of sequence) {
    const actionType = desc.split(':')[0];
    const action = actions.find(a => a.type === actionType);
    if (!action || !action.precondition(state)) return false;
    state = action.execute(state, rng);
  }

  const inv = invariants.find(i => i.name === invariantName);
  return inv ? !inv.check(state) : false;
}
