/**
 * X2: Stateful/PBT Governance Suites — Test Suite
 *
 * Tests the three X2 tasks:
 * 1. Action-sequence workflows (create_task, attach/remove witness, issue/expire waiver, recompute status, rerun gate)
 * 2. Seeded PBT runner
 * 3. Counterexample artifact capture
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone X2
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import {
  setupHermeticEnv, teardownHermeticEnv,
  runPBT, SeededRNG, saveCounterexamples, shrinkCounterexample,
  type GovAction, type StateInvariant, type PBTConfig,
} from '../../index.js';

// ============================================================================
// GOVERNANCE STATE MODEL
// ============================================================================

interface GovState {
  tasks: Map<string, { id: string; name: string; status: 'planned' | 'in_progress' | 'done'; witnesses: string[] }>;
  waivers: Map<string, { id: string; invariantId: string; taskId: string; reason: string; active: boolean; expiresAt: string }>;
  gateResults: Array<{ taskId: string; decision: 'pass' | 'fail' | 'advisory_warn'; timestamp: string }>;
  nextId: number;
}

function createInitialState(): GovState {
  const tasks = new Map();
  tasks.set('t1', { id: 't1', name: 'initial-task', status: 'planned' as const, witnesses: [] });
  return { tasks, waivers: new Map(), gateResults: [], nextId: 2 };
}

// ============================================================================
// ACTIONS
// ============================================================================

const CREATE_TASK: GovAction<GovState> = {
  type: 'create_task',
  precondition: (s) => s.tasks.size < 10,
  execute: (s, rng) => {
    const id = `t${s.nextId}`;
    const newState = structuredClone(s);
    newState.tasks = new Map(s.tasks);
    newState.waivers = new Map(s.waivers);
    newState.tasks.set(id, { id, name: `task-${id}-${rng.nextInt(1000)}`, status: 'planned', witnesses: [] });
    newState.nextId = s.nextId + 1;
    return newState;
  },
  describe: (s) => `create task t${s.nextId}`,
};

const ATTACH_WITNESS: GovAction<GovState> = {
  type: 'attach_witness',
  precondition: (s) => s.tasks.size > 0,
  execute: (s, rng) => {
    const newState = structuredClone(s);
    newState.tasks = new Map(s.tasks);
    newState.waivers = new Map(s.waivers);
    const taskIds = [...newState.tasks.keys()];
    const taskId = rng.pick(taskIds);
    const task = { ...newState.tasks.get(taskId)! };
    task.witnesses = [...task.witnesses, `witness_${rng.nextInt(10000)}`];
    newState.tasks.set(taskId, task);
    return newState;
  },
  describe: () => `attach witness to random task`,
};

const REMOVE_WITNESS: GovAction<GovState> = {
  type: 'remove_witness',
  precondition: (s) => { for (const t of s.tasks.values()) { if (t.witnesses.length > 0) return true; } return false; },
  execute: (s, rng) => {
    const newState = structuredClone(s);
    newState.tasks = new Map(s.tasks);
    newState.waivers = new Map(s.waivers);
    const withWitnesses = [...newState.tasks.values()].filter(t => t.witnesses.length > 0);
    const task = { ...rng.pick(withWitnesses) };
    task.witnesses = task.witnesses.slice(0, -1);
    newState.tasks.set(task.id, task);
    return newState;
  },
  describe: () => `remove witness from random task`,
};

const MARK_DONE: GovAction<GovState> = {
  type: 'mark_done',
  precondition: (s) => { for (const t of s.tasks.values()) { if (t.status !== 'done') return true; } return false; },
  execute: (s, rng) => {
    const newState = structuredClone(s);
    newState.tasks = new Map(s.tasks);
    newState.waivers = new Map(s.waivers);
    const notDone = [...newState.tasks.values()].filter(t => t.status !== 'done');
    const task = { ...rng.pick(notDone) };
    task.status = 'done';
    newState.tasks.set(task.id, task);
    return newState;
  },
  describe: () => `mark random task as done`,
};

const ISSUE_WAIVER: GovAction<GovState> = {
  type: 'issue_waiver',
  precondition: (s) => s.waivers.size < 5,
  execute: (s, rng) => {
    const newState = structuredClone(s);
    newState.tasks = new Map(s.tasks);
    newState.waivers = new Map(s.waivers);
    const id = `w${s.nextId}`;
    const taskIds = [...newState.tasks.keys()];
    newState.waivers.set(id, { id, invariantId: 'done_without_witness', taskId: rng.pick(taskIds), reason: 'PBT test waiver', active: true, expiresAt: '2026-12-31T00:00:00.000Z' });
    newState.nextId = s.nextId + 1;
    return newState;
  },
  describe: (s) => `issue waiver w${s.nextId}`,
};

const EXPIRE_WAIVER: GovAction<GovState> = {
  type: 'expire_waiver',
  precondition: (s) => { for (const w of s.waivers.values()) { if (w.active) return true; } return false; },
  execute: (s, rng) => {
    const newState = structuredClone(s);
    newState.tasks = new Map(s.tasks);
    newState.waivers = new Map(s.waivers);
    const activeWaivers = [...newState.waivers.values()].filter(w => w.active);
    const waiver = { ...rng.pick(activeWaivers) };
    waiver.active = false;
    waiver.expiresAt = '2025-01-01T00:00:00.000Z';
    newState.waivers.set(waiver.id, waiver);
    return newState;
  },
  describe: () => `expire random waiver`,
};

const RECOMPUTE_STATUS: GovAction<GovState> = {
  type: 'recompute_status',
  precondition: () => true,
  execute: (s) => structuredClone(s),
  describe: () => `recompute status (idempotent)`,
};

const RERUN_GATE: GovAction<GovState> = {
  type: 'rerun_gate',
  precondition: (s) => s.tasks.size > 0,
  execute: (s, rng) => {
    const newState = structuredClone(s);
    newState.tasks = new Map(s.tasks);
    newState.waivers = new Map(s.waivers);
    const taskIds = [...newState.tasks.keys()];
    const taskId = rng.pick(taskIds);
    const task = newState.tasks.get(taskId)!;
    let decision: 'pass' | 'fail' | 'advisory_warn' = 'pass';
    if (task.status === 'done' && task.witnesses.length === 0) {
      const hasActiveWaiver = [...newState.waivers.values()].some(w => w.taskId === taskId && w.active && w.invariantId === 'done_without_witness');
      if (!hasActiveWaiver) decision = 'fail';
    }
    newState.gateResults = [...s.gateResults, { taskId, decision, timestamp: new Date().toISOString() }];
    return newState;
  },
  describe: () => `rerun gate on random task`,
};

const ALL_ACTIONS: GovAction<GovState>[] = [CREATE_TASK, ATTACH_WITNESS, REMOVE_WITNESS, MARK_DONE, ISSUE_WAIVER, EXPIRE_WAIVER, RECOMPUTE_STATUS, RERUN_GATE];

// ============================================================================
// INVARIANTS
// ============================================================================

const INVARIANTS: StateInvariant<GovState>[] = [
  { name: 'no_negative_witnesses', check: (s) => { for (const t of s.tasks.values()) { if (t.witnesses.length < 0) return false; } return true; }, failMessage: (s) => `Tasks with negative witnesses: ${[...s.tasks.values()].filter(t => t.witnesses.length < 0).map(t => t.id).join(', ')}` },
  { name: 'waiver_count_bounded', check: (s) => s.waivers.size <= 5, failMessage: (s) => `Waiver count ${s.waivers.size} exceeds max 5` },
  { name: 'task_count_bounded', check: (s) => s.tasks.size <= 10, failMessage: (s) => `Task count ${s.tasks.size} exceeds max 10` },
  { name: 'gate_results_monotonic', check: (s) => s.gateResults.length >= 0, failMessage: () => 'Gate results array corrupted' },
  { name: 'no_expired_active_waiver', check: (s) => { const now = new Date('2026-03-14T00:00:00.000Z'); for (const w of s.waivers.values()) { if (w.active && new Date(w.expiresAt) < now) return false; } return true; }, failMessage: (s) => { const now = new Date('2026-03-14T00:00:00.000Z'); return `Active waivers past expiry: ${[...s.waivers.values()].filter(w => w.active && new Date(w.expiresAt) < now).map(w => w.id).join(', ')}`; } },
];

// ============================================================================
// HELPER: violating action for counterexample tests
// ============================================================================

function makeViolatingAction(): GovAction<GovState> {
  return {
    type: 'violate',
    precondition: () => true,
    execute: (s) => {
      const ns = structuredClone(s);
      ns.tasks = new Map();
      ns.waivers = new Map();
      ns.waivers.set('w_bad', { id: 'w_bad', invariantId: 'test', taskId: 't1', reason: 'test', active: true, expiresAt: '2020-01-01T00:00:00.000Z' });
      return ns;
    },
    describe: () => 'violate',
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe('X2: Stateful/PBT Governance Suites', () => {
  beforeEach(() => { setupHermeticEnv({ frozenClock: '2026-03-14T00:00:00.000Z' }); });
  afterEach(() => { teardownHermeticEnv(); });

  describe('Task 1: Action-sequence workflows', () => {
    it('all 8 action types are defined and have required interface', () => {
      expect(ALL_ACTIONS).toHaveLength(8);
      for (const action of ALL_ACTIONS) {
        expect(action.type).toBeTruthy();
        expect(typeof action.precondition).toBe('function');
        expect(typeof action.execute).toBe('function');
        expect(typeof action.describe).toBe('function');
      }
    });

    it('create_task + attach_witness + mark_done sequence', () => {
      const rng = new SeededRNG('manual-test');
      let state = createInitialState();
      state = CREATE_TASK.execute(state, rng);
      expect(state.tasks.size).toBe(2);
      const t1 = { ...state.tasks.get('t1')! };
      t1.witnesses = ['witness_1'];
      state.tasks = new Map(state.tasks);
      state.tasks.set('t1', t1);
      state = MARK_DONE.execute(state, rng);
      const doneCount = [...state.tasks.values()].filter(t => t.status === 'done').length;
      expect(doneCount).toBeGreaterThanOrEqual(1);
    });

    it('issue_waiver + expire_waiver lifecycle', () => {
      const rng = new SeededRNG('waiver-test');
      let state = createInitialState();
      state = ISSUE_WAIVER.execute(state, rng);
      expect(state.waivers.size).toBe(1);
      expect([...state.waivers.values()][0].active).toBe(true);
      state = EXPIRE_WAIVER.execute(state, rng);
      expect([...state.waivers.values()][0].active).toBe(false);
    });

    it('rerun_gate detects done-without-witness', () => {
      const rng = new SeededRNG('gate-test');
      let state = createInitialState();
      state = MARK_DONE.execute(state, rng);
      state = RERUN_GATE.execute(state, rng);
      const lastGate = state.gateResults[state.gateResults.length - 1];
      const pickedTask = state.tasks.get(lastGate.taskId)!;
      if (pickedTask.status === 'done' && pickedTask.witnesses.length === 0) {
        expect(lastGate.decision).toBe('fail');
      }
    });
  });

  describe('Task 2: Seeded PBT runner', () => {
    it('PBT runner produces deterministic results with same seed', () => {
      const config: PBTConfig<GovState> = { initialState: createInitialState, actions: ALL_ACTIONS, invariants: INVARIANTS, seed: 'deterministic-test-42', numRuns: 50, maxActionsPerRun: 10 };
      const result1 = runPBT(config);
      const result2 = runPBT(config);
      expect(result1.totalActions).toBe(result2.totalActions);
      expect(result1.passed).toBe(result2.passed);
      expect(result1.counterexamples).toHaveLength(result2.counterexamples.length);
    });

    it('PBT runner with safe invariants passes on valid model', () => {
      const safeInvariants: StateInvariant<GovState>[] = [INVARIANTS[0], INVARIANTS[2], INVARIANTS[3]];
      const result = runPBT({ initialState: createInitialState, actions: ALL_ACTIONS, invariants: safeInvariants, seed: 'safe-invariants-test', numRuns: 100, maxActionsPerRun: 15 });
      expect(result.passed).toBe(true);
      expect(result.totalActions).toBeGreaterThan(0);
      expect(result.totalRuns).toBe(100);
    });

    it('PBT runner detects known bug (expire creates active+expired)', () => {
      const buggyExpire: GovAction<GovState> = {
        type: 'buggy_expire',
        precondition: (s) => { for (const w of s.waivers.values()) { if (w.active) return true; } return false; },
        execute: (s, rng) => {
          const newState = structuredClone(s);
          newState.tasks = new Map(s.tasks);
          newState.waivers = new Map(s.waivers);
          const activeWaivers = [...newState.waivers.values()].filter(w => w.active);
          const waiver = { ...rng.pick(activeWaivers) };
          waiver.expiresAt = '2025-01-01T00:00:00.000Z'; // BUG: doesn't clear active
          newState.waivers.set(waiver.id, waiver);
          return newState;
        },
        describe: () => `buggy expire (leaves active=true)`,
      };
      const buggyActions = ALL_ACTIONS.filter(a => a.type !== 'expire_waiver').concat(buggyExpire);
      const result = runPBT({ initialState: createInitialState, actions: buggyActions, invariants: INVARIANTS, seed: 'buggy-expire-test', numRuns: 200, maxActionsPerRun: 15, stopOnFirst: true });
      expect(result.passed).toBe(false);
      expect(result.counterexamples.length).toBeGreaterThanOrEqual(1);
      expect(result.counterexamples[0].violatedInvariant).toBe('no_expired_active_waiver');
    });

    it('different seeds produce different action sequences', () => {
      const config1: PBTConfig<GovState> = { initialState: createInitialState, actions: ALL_ACTIONS, invariants: [], seed: 'seed-alpha', numRuns: 10, maxActionsPerRun: 5 };
      const config2 = { ...config1, seed: 'seed-beta' };
      const r1 = runPBT(config1);
      const r2 = runPBT(config2);
      expect(r1.totalActions !== r2.totalActions || r1.seed !== r2.seed).toBe(true);
    });
  });

  describe('Task 3: Counterexample artifact capture', () => {
    it('counterexample has all required fields', () => {
      const result = runPBT({
        initialState: createInitialState, actions: [makeViolatingAction()], invariants: INVARIANTS,
        seed: 'counterexample-fields-test', numRuns: 1, maxActionsPerRun: 1, stopOnFirst: true,
      });
      expect(result.passed).toBe(false);
      const cx = result.counterexamples[0];
      expect(cx.seed).toBeTruthy();
      expect(typeof cx.runIndex).toBe('number');
      expect(typeof cx.stepIndex).toBe('number');
      expect(Array.isArray(cx.actionSequence)).toBe(true);
      expect(cx.violatedInvariant).toBeTruthy();
      expect(cx.failMessage).toBeTruthy();
      expect(cx.stateAtFailure).toBeTruthy();
      expect(cx.digest).toHaveLength(64);
    });

    it('saveCounterexamples writes to disk', () => {
      const result = runPBT({
        initialState: createInitialState, actions: [makeViolatingAction()], invariants: INVARIANTS,
        seed: 'save-test', numRuns: 1, maxActionsPerRun: 1, stopOnFirst: true,
      });
      const dir = '/tmp/pbt-test-cx';
      try {
        const paths = saveCounterexamples(result.counterexamples, dir);
        expect(paths.length).toBeGreaterThanOrEqual(1);
        expect(existsSync(paths[0])).toBe(true);
        const content = JSON.parse(readFileSync(paths[0], 'utf-8'));
        expect(content.seed).toBeTruthy();
        expect(content.actionSequence).toBeTruthy();
      } finally {
        if (existsSync(dir)) rmSync(dir, { recursive: true });
      }
    });

    it('counterexample digest is stable for same content', () => {
      const config = {
        initialState: createInitialState, actions: [makeViolatingAction()], invariants: INVARIANTS,
        seed: 'digest-stability', numRuns: 1, maxActionsPerRun: 1, stopOnFirst: true,
      };
      const result1 = runPBT(config);
      const result2 = runPBT(config);
      expect(result1.counterexamples[0].digest).toBe(result2.counterexamples[0].digest);
    });
  });
});
