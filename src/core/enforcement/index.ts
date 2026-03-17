export {
  evaluateEnforcementGate,
  computeRiskSummary,
  computeDecisionHash,
  DEFAULT_CONFIG,
  type EnforcementGateConfig,
  type EnforcementResult,
  type AffectedNode,
  type RiskSummary,
  type ApprovalRequirement,
  type EnforcementDecision,
  type GateMode,
  type WaiverPolicy,
} from './enforcement-gate.js';

export {
  resolveAffectedNodes,
  resolveBlastRadius,
} from './graph-resolver.js';
