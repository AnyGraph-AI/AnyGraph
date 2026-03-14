/**
 * Micro Fixtures — Commit Path
 *
 * Fast, versioned, deterministic fixtures for unit tests.
 * Version-tagged so replay packets remain stable across fixture updates.
 *
 * @version 1.0.0
 */

export {
  CODE_GRAPH_FIXTURE_VERSION,
  SINGLE_FUNCTION,
  CROSS_FILE_CALL,
  HIGH_RISK_HUB,
  STATEFUL_CLASS,
} from './code-graph.fixture.js';

export {
  PLAN_GRAPH_FIXTURE_VERSION,
  SIMPLE_PLAN,
  PLAN_WITH_DRIFT,
  BLOCKED_CHAIN,
  PLAN_WITH_DECISION,
} from './plan-graph.fixture.js';
