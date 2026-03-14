# HYGIENE_GOVERNANCE_RESEARCH_REPORT

Status: Research-backed draft  
Scope: Standalone repository hygiene and AI agent hygiene governance plan for AnyGraph. This plan is intentionally separate from the core AnyGraph architecture roadmap and is designed to be executed by the same graph-governed engine without duplicating ORG/EVT/RED/REL work.

## Design Boundary

This plan assumes AnyGraph already has a graph source of truth, plan parsing, verification runs, gate decisions, governance metrics, and evidence objects. The hygiene domain is responsible for cleanliness, ownership, safety, and AI-agent operating constraints. It should consume those core capabilities, not recreate them.

## Roadmap

### HY-1 Hygiene Domain Boundary

- [ ] Define a standalone hygiene governance domain and separate plan file that AnyGraph executes without duplicating the core architecture roadmap.
- [ ] Bind hygiene controls to existing Repo, VerificationRun, GateDecision, CommitSnapshot, Artifact, and DocumentWitness entities instead of introducing parallel core abstractions.
- [ ] Record explicit non-goals for the hygiene domain so repository cleanliness policy cannot sprawl into ORG/EVT/RED/REL work already owned by the core plan.

DEPENDS_ON NONE

### HY-2 Hygiene Failure Class Taxonomy

- [ ] Introduce HygieneFailureClass values for regression, security issue, reliability issue, and governance drift.
- [ ] Map every baseline control from HYGIENE_BASELINE_V1 to one or more failure classes and reject controls that lack a measurable failure target.
- [ ] Persist required success signals for each control so promotion decisions are evidence-based instead of preference-based.

DEPENDS_ON HY-1

### HY-3 Hygiene Control Registry Schema

- [ ] Introduce HygieneControl, HygieneViolation, HygieneException, and HygieneMetricSnapshot nodes with stable IDs and schema versions.
- [ ] Add graph fields for severity, mode, owner, appliesTo, successSignal, noiseBudgetImpact, and retirementStatus.
- [ ] Create canonical edges APPLIES_TO, VIOLATES, TRIGGERED_BY, WAIVES, MEASURED_BY, and REMEDIATED_BY for hygiene state transitions.

DEPENDS_ON HY-2

### HY-4 Repository Hygiene Profile

- [ ] Introduce RepoHygieneProfile to capture canonical roots, allowed path classes, artifact zones, generated-code zones, and exception zones per repository type.
- [ ] Bind each repository to exactly one active profile and preserve version history when a profile changes.
- [ ] Define profile inheritance so language- or repo-class defaults can be reused without copying rules into every repository.

DEPENDS_ON HY-3

### HY-5 Ownership Schema

- [ ] Introduce ownership entities for critical files, directories, skills, runbooks, docs, and gates with support for team, person, and service owners.
- [ ] Require ownership freshness metadata such as ownerVerifiedAt, backupOwner, escalationPath, and review cadence.
- [ ] Persist owner-to-scope bindings in graph form so ownership queries are structural instead of text-only.

DEPENDS_ON HY-4

### HY-6 Ownership Verification

- [ ] Flag unowned or stale-owned critical paths as hygiene violations with severity derived from path criticality.
- [ ] Verify parity between graph ownership and platform ownership mechanisms such as CODEOWNERS where available.
- [ ] Surface ownership coverage, stale owners, and orphaned scopes in advisory hygiene reports before any fail-closed promotion.

DEPENDS_ON HY-5

### HY-7 Folder Topology Contract

- [ ] Define canonical directory classes for source, tests, docs, scripts, artifacts, ops, generated outputs, and third-party material.
- [ ] Require each repository profile to declare allowed, deprecated, and forbidden path patterns for these classes.
- [ ] Persist topology manifests in machine-checkable form so the graph can tell agents where new feature code is expected to live.

DEPENDS_ON HY-6

### HY-8 Path, Size, and Extension Enforcement

- [ ] Add verifiers for restricted paths, deprecated folders, maximum path length, allowed extensions, and maximum file size by repository profile.
- [ ] Mirror platform-native path restrictions and file policies where the forge supports them so graph policy and repo policy stay aligned.
- [ ] Require scoped exceptions with expiry for necessary path rule bypasses instead of silent one-off deviations.

DEPENDS_ON HY-7

### HY-9 Module Inventory and Structural Mapping

- [ ] Build a module inventory from repository structure and dependency data with stable identifiers for modules, packages, services, and libraries.
- [ ] Attach owner, primary path, lifecycle status, and related plan milestone links to every governed module.
- [ ] Add explicit links from modules to docs, runbooks, and tests so module hygiene is queryable as graph structure instead of inferred text.

DEPENDS_ON HY-8

### HY-10 Orphan, Duplicate, and Deprecated Detection

- [ ] Flag modules and files that have no meaningful inbound references, no plan linkage, and no valid owner as candidate orphans.
- [ ] Detect probable duplicate logic or duplicate folder patterns using path, symbol, import, and file-role heuristics before heavier clone analysis.
- [ ] Track deprecated files and directories with migration targets and expiry dates so cleanup work becomes explicit and auditable.

DEPENDS_ON HY-9

### HY-11 README Contract

- [ ] Define machine-checkable README requirements by repository type, including what, why, quickstart, architecture, gates or runbooks, troubleshooting, and last-verified sections.
- [ ] Version the README schema so repositories can migrate deliberately rather than break on template drift.
- [ ] Require each README to link to its owning runbook or architecture doc and to a verification timestamp or equivalent proof of freshness.

DEPENDS_ON HY-10

### HY-12 Documentation Anchor Contract

- [ ] Require major docs to map to concrete components, paths, services, or workflows via durable anchors rather than vague prose-only references.
- [ ] Verify broken, stale, or obsolete anchors and distinguish architecture docs, runbooks, release notes, incident docs, and postmortems.
- [ ] Persist doc-to-code and doc-to-owner links so the graph can prove whether a feature or module is documented and maintained.

DEPENDS_ON HY-11

### HY-13 Template Contract

- [ ] Define canonical templates for README, runbooks, postmortems, release notes, and repository bootstrap files with explicit schema versions.
- [ ] Allow profile-scoped template overrides only when the override records rationale, owner, and expiry or review cadence.
- [ ] Verify template conformance in hygiene checks without promoting template taste into fail-closed policy until the signal is proven high enough.

DEPENDS_ON HY-12

### HY-14 Proof-of-Done Scope Contract

- [ ] Define which tasks, components, and change classes are critical and therefore require graph-backed evidence before they can be marked done.
- [ ] Bind accepted evidence classes to the existing AnyGraph evidence model such as runs, gates, artifacts, runtime evidence, and witnesses.
- [ ] Record negative rules showing when plan-only or code-only evidence is insufficient for a claimed completion state.

DEPENDS_ON HY-13

### HY-15 Proof-of-Done Verification

- [ ] Flag done-without-evidence for scoped critical work and compute proof coverage by repo, team, and milestone family.
- [ ] Prevent completion or promotion when critical changes lack the required runtime, build, or governance evidence defined by the scope contract.
- [ ] Escalate repeated false-complete behavior into stronger hygiene violations with audit trails rather than burying it in generic CI failures.

DEPENDS_ON HY-14

### HY-16 Exception and Waiver Schema

- [ ] Introduce structured hygiene exceptions with reason, approver, ticketRef, expiry, scope, risk level, and remediation linkage.
- [ ] Require every exception to reference the exact HygieneViolation or HygieneControl it waives and to persist a decision hash.
- [ ] Separate emergency bypasses from standing waivers so the graph can reason about urgent overrides versus accepted temporary debt.

DEPENDS_ON HY-15

### HY-17 Exception Governance

- [ ] Fail expired exceptions by default and compute exception debt by repo, owner, and control family.
- [ ] Require renewal, revocation, and post-expiry remediation workflows instead of indefinite carry-forward.
- [ ] Add review queues and escalation rules for repositories accumulating concentrated waiver debt or repeated bypasses of the same control.

DEPENDS_ON HY-16

### HY-18 Security Baseline Parity

- [ ] Verify protected branches or rulesets, CODEOWNERS participation, required reviews, required status checks, and merge constraints for governed repositories.
- [ ] Record signed-commit posture, linear-history posture, and force-push restrictions where the hosting platform supports them.
- [ ] Surface parity drift between graph-declared hygiene policy and actual repository platform settings as a first-class hygiene violation.

DEPENDS_ON HY-17

### HY-19 Secret and Dependency Hygiene Baseline

- [ ] Verify secret scanning or push protection posture and dependency review or equivalent pre-merge dependency checks for governed repositories.
- [ ] Support organization-specific custom secret patterns and escalation ownership for secret findings instead of relying only on provider defaults.
- [ ] Link dependency-review failures, stale dependencies, and missing dependency metadata back into hygiene status rather than leaving them as disconnected security alerts.

DEPENDS_ON HY-18

### HY-20 Provenance and SBOM Baseline

- [ ] Require SBOM export capability or equivalent machine-readable dependency inventory for repositories above a defined criticality threshold.
- [ ] Record availability and freshness of build provenance or attestations separately from release gating so provenance can start advisory and grow into stronger enforcement.
- [ ] Link provenance, SBOM, and dependency inventory artifacts into the graph as hygiene evidence instead of leaving them as isolated files.

DEPENDS_ON HY-19

### HY-21 Cost and Latency Hygiene

- [ ] Track runtime, queue time, compute cost, and verification latency per hygiene run and per major control family.
- [ ] Define p50 and p95 thresholds by repository profile and change class so hygiene does not quietly become a workflow tax.
- [ ] Flag sustained latency or cost regressions as hygiene issues when they materially degrade developer flow or agent throughput.

DEPENDS_ON HY-20

### HY-22 Hygiene Metrics Snapshot

- [ ] Materialize HygieneMetricSnapshot nodes using the same lineage discipline AnyGraph already applies to governance metrics.
- [ ] Include proof coverage, ownership coverage, exception debt, doc freshness, orphan counts, duplicate counts, and advisory-versus-enforced control posture.
- [ ] Hash snapshot payloads and record metric definitions so hygiene metrics remain reproducible and auditable over time.

DEPENDS_ON HY-21

### HY-23 Policy Bundle and Decision Log Integration

- [ ] Version hygiene policies as bundles or equivalent packaged policy sets instead of scattering logic across unrelated scripts.
- [ ] Emit decision logs for hygiene evaluations that capture the queried control, input context, bundle metadata, and verdict for audit and offline debugging.
- [ ] Prevent ad hoc runtime mutation of bundled hygiene policy without a governed rollout path and a recorded policy version change.

DEPENDS_ON HY-22

### HY-24 Advisory Hygiene Surfaces

- [ ] Expose hygiene status in done-check, dashboards, and review surfaces with concise path-scoped remediation guidance.
- [ ] Keep advisory output focused on changed files, violated controls, missing evidence, and ownership gaps instead of dumping generic lint noise.
- [ ] Add drill-down links from every surfaced violation back to graph evidence so developers and agents can fix the right thing quickly.

DEPENDS_ON HY-23

### HY-25 Repository Bootstrap Pack

- [ ] Generate starter files, manifests, templates, and policy bindings for new repositories from RepoHygieneProfile presets.
- [ ] Validate freshly bootstrapped repositories against the hygiene profile so new repos start in a clean, governed state.
- [ ] Separate bootstrap presets for libraries, services, tooling repos, documentation repos, and agent repos to reduce false positives and overgeneralization.

DEPENDS_ON HY-24

### HY-26 Multi-Repo Hygiene Rollups

- [ ] Compute org-level and team-level hygiene rollups such as coverage, exception debt, stale-doc hotspots, and ownerless critical paths.
- [ ] Rank repositories by risk-adjusted hygiene gap so enforcement and cleanup can focus on the places that matter most.
- [ ] Preserve repo-local overrides in rollups rather than flattening everything into a misleading single score.

DEPENDS_ON HY-25

### HY-27 Enforcement Promotion and Rollback

- [ ] Define measurable criteria for promoting high-signal controls such as proof-of-done, exception expiry, and security baseline parity from advisory to enforced.
- [ ] Roll out enforcement through canaries by repo profile and control family before broad fail-closed adoption.
- [ ] Add rollback triggers for false positives, severe workflow slowdown, or policy drift so hygiene enforcement remains trusted.

DEPENDS_ON HY-26

### HY-28 Control Effectiveness Analytics

- [ ] Measure prevented regressions, override rate, remediation time, and workflow cost for each hygiene control family.
- [ ] Compare the benefit of a control against its friction and maintenance burden using the failure classes defined at the start of the track.
- [ ] Use effectiveness results to decide whether controls should remain advisory, be promoted, be simplified, or be retired.

DEPENDS_ON HY-27

### HY-29 Control Budget and Retirement

- [ ] Set control-density budgets by repository profile and gate so hygiene cannot sprawl unchecked as the system matures.
- [ ] Require new controls to displace, subsume, or quantitatively justify themselves against existing controls before adoption.
- [ ] Retire or downgrade controls that show persistently low signal, duplicated coverage, or high friction with low prevention value.

DEPENDS_ON HY-28


### AIH-1 AI Hygiene Domain Boundary

- [ ] Define a standalone AI hygiene governance domain layered on top of AnyGraph and HY controls without duplicating the core AnyGraph roadmap.
- [ ] Bind AI hygiene to existing repositories, runs, commits, evidence, and governance metrics while introducing only the minimum additional AI-specific entities required.
- [ ] Record non-goals for this domain so AI hygiene remains focused on safe, auditable agent operation rather than broad product or model research policy.

DEPENDS_ON NONE

### AIH-2 Skill and Agent Policy Registry

- [ ] Introduce Skill, AgentPolicy, AgentApproval, AgentEvalRun, AgentSession, and AgentIncident nodes with stable IDs and schema versions.
- [ ] Bind every skill and agent policy to owners, repository scopes, path scopes, risk tiers, and verification lineage.
- [ ] Add graph edges so skill versions, approvals, evals, sessions, and incidents can be queried as one auditable governance domain.

DEPENDS_ON AIH-1

### AIH-3 SKILL.md Contract Schema

- [ ] Require machine-checkable SKILL.md fields for purpose, triggers, inputs and outputs, allowed tools, forbidden actions, safety boundaries, owner, version, and last-verified state.
- [ ] Separate instruction-only skills from script-backed skills and record the capability model for each skill explicitly in graph metadata.
- [ ] Version the contract schema so skill evolution is deliberate and backward compatibility is testable.

DEPENDS_ON AIH-2

### AIH-4 Repository Instruction Sync

- [ ] Bind skill contracts to repository-level and path-specific custom instructions so agents receive consistent guidance about how code should be built, tested, and validated.
- [ ] Detect contradictions between SKILL.md, repository custom instructions, and graph-declared hygiene policy before those contradictions cause agent drift.
- [ ] Persist instruction precedence rules so agent behavior stays deterministic when multiple instruction layers apply.

DEPENDS_ON AIH-3

### AIH-5 Skill Resource and Example Contract

- [ ] Require linked resources, scripts, examples, fixtures, and optional helper assets for skills that need more than a plain-text instruction block.
- [ ] Map every resource to a repository scope, path scope, and data classification so skill context injection remains intentional and auditable.
- [ ] Verify that referenced resources exist, remain fresh, and do not silently drift away from the skill version that expects them.

DEPENDS_ON AIH-4

### AIH-6 Skill Invocation Precision

- [ ] Build eval sets that include positive, implicit, contextual, and negative prompts for every promoted skill.
- [ ] Measure trigger precision, trigger recall, and false positive invocation rate so vague or overloaded skills cannot quietly spread chaos.
- [ ] Block promotion of skills whose names, descriptions, or triggers do not reliably map to the situations they are supposed to handle.

DEPENDS_ON AIH-5

### AIH-7 Agent Action Taxonomy

- [ ] Define low, medium, high, and critical action classes for file edits, schema changes, policy changes, release-affecting changes, and exfiltration-sensitive operations.
- [ ] Map each action class to approval requirements, evidence requirements, and logging requirements that are machine-verifiable in the graph.
- [ ] Allow per-repository overrides only through explicit policy objects rather than ad hoc prompt instructions.

DEPENDS_ON AIH-6

### AIH-8 Approval Evidence and Scope

- [ ] Persist approver, timestamp, decision hash, scope, and expiry for any AI action that requires review or explicit authorization.
- [ ] Bind approvals to exact runs, sessions, repositories, and commit ranges so approvals cannot be replayed outside their intended scope.
- [ ] Prevent silent widening of approval scope by requiring a new approval object whenever path, repo, action class, or risk level changes materially.

DEPENDS_ON AIH-7

### AIH-9 Tool Permission Model

- [ ] Define allowlist and denylist policies for shell commands, MCP servers, browsers, network calls, package managers, and other agent tools.
- [ ] Classify tools by side effect, privilege level, data sensitivity, and egress potential so permission decisions are not buried in prose.
- [ ] Require least-privilege defaults for every skill and every repository profile, with explicit recorded escalation when broader access is needed.

DEPENDS_ON AIH-8

### AIH-10 Sandbox and Execution Boundaries

- [ ] Require sandboxed execution for write-capable or network-capable agent tasks by default, with clear distinctions among read-only, limited-write, and full-auto modes.
- [ ] Verify that agent sessions cannot silently widen permissions mid-run without generating a new approval or policy event.
- [ ] Persist sandbox mode, environment identity, and scope of side effects as graph evidence for every materially privileged agent run.

DEPENDS_ON AIH-9

### AIH-11 Prompt and Skill Drift Governance

- [ ] Treat prompt and skill changes as reviewable artifacts with owners, diffs, and changelog semantics rather than ephemeral prompt text.
- [ ] Detect unresolved regression deltas between prompt or skill versions and block promotion when drift degrades required behavior.
- [ ] Require agent policy updates to reference the exact skill and prompt versions they assume so policy and behavior cannot drift independently.

DEPENDS_ON AIH-10

### AIH-12 Eval Registry and Versioning

- [ ] Version eval sets, fixtures, rubrics, expected outcomes, and scoring thresholds for each promoted skill or agent policy.
- [ ] Bind every evaluation result to the specific skill version, model or provider version, tool bundle, and repository profile used during the run.
- [ ] Preserve historical baselines and negative controls so replay and regression analysis remain possible after the system evolves.

DEPENDS_ON AIH-11

### AIH-13 Eval Promotion Gates

- [ ] Require outcome, process, style, and efficiency checks for promoted skills and agent behaviors, keeping the must-pass set small and high-signal.
- [ ] Support advisory and strict promotion modes so new skills can mature without instantly becoming blocking controls.
- [ ] Only expand eval coverage when new cases are tied to real observed failures, misses, or false activations.

DEPENDS_ON AIH-12

### AIH-14 Model and Provider Change Governance

- [ ] Treat model, provider, and major configuration changes as governed change events instead of implicit environment updates.
- [ ] Require compatibility and regression evaluation before a new model or provider is promoted into a production agent path.
- [ ] Record approved fallback models and rollback paths so AI governance survives outages or sudden provider regressions.

DEPENDS_ON AIH-13

### AIH-15 Evidence Attribution Contract for Agent Outputs

- [ ] Require source traces or graph-backed evidence for material agent claims where the repository, action class, or task type demands proof.
- [ ] Distinguish cited facts, bounded inferences, and uncited suggestions in agent outputs so users can tell what is verified versus reasoned.
- [ ] Bind every high-impact status assertion to supporting graph evidence or block the assertion when support is insufficient.

DEPENDS_ON AIH-14

### AIH-16 Unsupported Claim Blockers

- [ ] Define explicit claim classes such as complete, safe, verified, merged-ready, and production-ready that require proof before they can be surfaced or acted upon.
- [ ] Verify agent-produced status messages against graph evidence and persist violations when the claimed state is unsupported.
- [ ] Escalate repeated false-complete or false-safe claims into stronger governance responses rather than burying them as chat mistakes.

DEPENDS_ON AIH-15

### AIH-17 Prompt Injection and Input Trust Boundaries

- [ ] Classify inputs from web pages, issue comments, pull request discussion, chat, documentation, and MCP sources by trust level and mutation risk.
- [ ] Add sanitization, quoting, and isolation rules for untrusted content when assembling agent context or constructing tool inputs.
- [ ] Require explicit boundary markers whenever untrusted content is passed into a high-impact or privileged agent workflow.

DEPENDS_ON AIH-16

### AIH-18 Insecure Output Handling Guards

- [ ] Treat model output as untrusted until validated before it is executed, applied to privileged configs, or sent into side-effectful tools.
- [ ] Require structured parsers or validators for commands, patches, config edits, and policy updates that can change repository or platform state.
- [ ] Block raw output from being routed directly into privileged tools unless a governed escape hatch and review path is used.

DEPENDS_ON AIH-17

### AIH-19 Data Leakage and Secret Handling

- [ ] Restrict agent access to secrets and sensitive files according to least-privilege policy and explicit repository data classifications.
- [ ] Log and review high-risk reads, writes, clipboard-like transfers, and outbound transmissions that touch sensitive material.
- [ ] Integrate secret scanning, push protection, and organization-specific secret patterns into agent output review so unsafe outputs are caught before they land.

DEPENDS_ON AIH-18

### AIH-20 AI Supply Chain Hygiene

- [ ] Track models, datasets, MCP servers, plugins, helper repos, and packaged agent tools as governed dependencies with owners and status metadata.
- [ ] Require model cards, dataset cards, or equivalent documentation for newly adopted AI dependencies above a defined risk threshold.
- [ ] Record provenance, license, and freshness status for external AI dependencies so agent behavior is not built on opaque components.

DEPENDS_ON AIH-19

### AIH-21 Agent Session Logging and Replay

- [ ] Persist agent session lineage including invoked skills, prompts, tools called, files touched, approvals consumed, and outputs produced.
- [ ] Support replay and differential comparison of agent runs on the same task so regressions and drift can be debugged offline.
- [ ] Hash normalized session transcripts or equivalent event summaries so audit and replay comparisons stay stable across storage layers.

DEPENDS_ON AIH-20

### AIH-22 Agent Cost and Time Budgets

- [ ] Define per-skill and per-repository budgets for tokens, wall-clock time, tool calls, retries, and external API spend.
- [ ] Flag thrashing, runaway loops, or repeated low-value retries as hygiene violations with remediation guidance.
- [ ] Separate exploratory budgets from merge-affecting or release-affecting budgets so strict paths remain predictable and auditable.

DEPENDS_ON AIH-21

### AIH-23 Agent Artifact Retention

- [ ] Retain essential agent artifacts such as plans, diffs, eval results, session logs, and approval objects with explicit lifecycle rules by risk class.
- [ ] Deduplicate large outputs while preserving content hashes and minimum replay metadata needed for audit and debugging.
- [ ] Define minimum retention windows and archive cutovers so AI governance evidence remains available without uncontrolled storage growth.

DEPENDS_ON AIH-22

### AIH-24 AI Security Regression Tests

- [ ] Add regression tests and red-team style negative cases for prompt injection, unsafe tool use, data exfiltration, approval bypass, and policy mutation attempts.
- [ ] Run these tests in advisory mode first and measure false positive and false negative behavior before promotion.
- [ ] Promote only those security tests that show stable signal and acceptable developer or agent friction.

DEPENDS_ON AIH-23

### AIH-25 Advisory Agent Surfaces

- [ ] Expose AI hygiene status in PRs, dashboards, and run summaries with concise explanations of blocked approvals, missing evals, and trust-boundary breaches.
- [ ] Keep output scoped to changed files, executed actions, and violated controls instead of flooding users with generic policy text.
- [ ] Provide graph links from surfaced AI violations to the exact session, approval, or eval evidence needed for remediation.

DEPENDS_ON AIH-24

### AIH-26 Strict Promotion and Rollback

- [ ] Define measurable criteria for moving high-signal AI controls such as approval gating, eval regression gating, and AI security guardrails from advisory to enforced.
- [ ] Roll out strict mode gradually by repository, skill, and action class rather than flipping the entire organization at once.
- [ ] Add rollback triggers for false positives, degraded developer throughput, or unacceptable agent failure rates so trust is preserved.

DEPENDS_ON AIH-25

### AIH-27 AI Control Effectiveness and Retirement

- [ ] Measure prevention value, override rate, latency cost, and developer friction for each AI hygiene control family.
- [ ] Retire, downgrade, or simplify controls that add noise without measurable benefit or that duplicate stronger existing controls.
- [ ] Feed effectiveness findings back into skill templates, approval policy defaults, and eval design so the system improves rather than accretes sludge.

DEPENDS_ON AIH-26


## Key Architectural Patterns Discovered

### 1) Platform-native repository policy should be mirrored, not reinvented
GitHub rulesets can require pull requests, status checks, code-owner reviews, signed commits, code scanning results, path restrictions, file-size restrictions, and bypass roles. That means the hygiene graph should verify parity with those controls instead of re-implementing them as disconnected logic. CODEOWNERS can be enforced together with branch protection, secret scanning covers full history and supports custom patterns, push protection blocks secrets before push, and dependency review catches insecure dependencies before merge.

### 2) Supply-chain trust should be represented as evidence, not as a slogan
OpenSSF Scorecard and the OSPS Baseline provide a practical minimum baseline for repository security and maintenance posture. SLSA frames provenance as verifiable information about where, when, and how an artifact was built, and in-toto provides a model of authorized steps plus signed link metadata that ties artifacts to expected supply-chain steps. Those patterns justify explicit hygiene objects for provenance availability, SBOM availability, and structured waivers.

### 3) Monorepo discipline depends on fine-grained structure and dependency visibility
Bazel emphasizes scalable multi-repo or monorepo builds and hermeticity. Pants emphasizes fine-grained work decomposition, dependency inference, caching, and readily inspectable dependency metadata. Those patterns support a hygiene profile with canonical topology, module inventory, orphan detection, duplicate detection, and path-specific ownership.

### 4) Durable governance needs replayable logs and auditable policy decisions
Temporal’s Event History shows the value of a complete durable log for replay, while OPA decision logs and bundles show how policy can be versioned, distributed, and audited without scattering business rules across scripts. Even though this hygiene plan is standalone from the core AnyGraph event-sourcing roadmap, it should still adopt policy bundle versioning and decision-log style evidence.

### 5) Provenance graphs are useful because they are structural, not narrative
CamFlow models execution as a directed acyclic graph over states and information flows. That strengthens the case for hygiene violations, ownership mappings, and evidence obligations being represented as graph structure instead of chat instructions or prose-only docs.

### 6) Reliability controls must balance speed and safety
Google SRE’s error-budget policy and canary guidance both center the idea that change should be measured against reliability, not blocked by default. DORA and Four Keys reinforce the need for throughput and recovery metrics rather than a single pass/fail view. That is why this plan keeps most hygiene controls advisory first and promotes only high-signal controls with measurable benefit.

### 7) AI hygiene must assume variable outputs, untrusted inputs, and least-privilege execution
OWASP’s LLM Top 10 highlights prompt injection, insecure output handling, training-data poisoning, denial of service, and supply-chain vulnerabilities. NIST AI RMF organizes AI governance under Govern, Map, Measure, and Manage. OpenAI’s eval guidance and skill-eval guidance emphasize explicit success criteria, negative controls, and keeping must-pass evals small and high signal. GitHub Copilot’s custom instructions and coding-agent docs show that agents already rely on repository instructions and external tools, which means instruction sync, permission boundaries, and approval evidence are necessary rather than optional.

### 8) Documentation quality matters when it is machine-checkable
Hugging Face’s model cards and dataset cards are useful exemplars: documentation becomes operationally valuable when it carries structured metadata, usage guidance, and provenance context. That supports README contracts, template contracts, and AI dependency cards instead of unstructured “please document this” norms.

## Known Failure Modes of Governance Systems

- **Control explosion:** too many low-value controls create alert fatigue and policy cynicism.
- **Platform drift:** graph policy says one thing while GitHub rulesets, CODEOWNERS, or branch settings say another.
- **False-complete work:** tasks are marked done because code exists, even though required evidence or runtime verification is missing.
- **Ownership rot:** teams change, files move, skills drift, and no one updates ownership or escalation paths.
- **Repo topology entropy:** AI agents create new folders, helper scripts, and undocumented modules in inconsistent places.
- **Waiver amnesia:** exceptions are granted without expiry, get reused out of scope, and silently become permanent policy holes.
- **Policy scattering:** enforcement logic spreads across scripts, prompts, comments, and CI snippets without a versioned policy source.
- **Advisory spam:** review surfaces show too much generic policy text and developers stop reading them.
- **Untrusted-input drift:** issue comments, web pages, docs, and PR discussions get pulled into agent context without clear trust boundaries.
- **Unsafe output routing:** model output becomes shell commands, config mutations, or policy updates without validation.
- **Eval theater:** teams add too many synthetic tests and lose sight of high-signal regressions tied to real failures.
- **Storage blow-up:** session logs, artifacts, and snapshots grow without retention policy until auditability becomes operationally expensive.

## Scaling Strategy

### Repository and module scale
- Use `RepoHygieneProfile` and `Module` inventories to avoid repo-specific one-off logic.
- Keep topology rules path-scoped and profile-based instead of per-file hand curation.
- Compute duplicate/orphan detection from structural metadata first, then add heavier analysis only where needed.

### Policy scale
- Package hygiene policy into versioned bundles with decision logs rather than hard-coding checks across many scripts.
- Separate policy evaluation from policy surfacing so the same verdict can feed done-check, PR advisories, dashboards, and audits.
- Keep advisory and enforced policy modes explicit in graph metadata.

### Evidence and artifact scale
- Retain only the minimum replay set for low-risk agent sessions; preserve fuller artifacts for high-risk sessions and policy-bypass events.
- Hash normalized session logs and metric payloads so deduplication does not destroy auditability.
- Prefer graph-linked artifact manifests over storing huge inline blobs in graph properties.

### Multi-repo scale
- Aggregate hygiene at the repo and team level, not only at the org-global level, to avoid a single noisy score.
- Rank repos by risk-adjusted hygiene gap so rollout and cleanup are targeted.
- Reuse repository presets for bootstrap and rule defaults to make multi-repo adoption tractable.

### Operational scale
- Track p50/p95 latency and cost for hygiene controls and AI sessions so the governance system itself has a performance budget.
- Roll out strict enforcement in canaries by repo profile, skill family, or action class.
- Retire controls aggressively when they duplicate stronger ones or fail to prove value.

## Hygiene SLOs

- **Hygiene snapshot freshness:** latest hygiene snapshot materialized within an agreed window after a governing verification run.
- **Ownership coverage:** critical paths with valid owners remain above a minimum threshold by repo profile.
- **Proof coverage:** critical completed tasks backed by required evidence remain above a minimum threshold by repo profile.
- **Exception freshness:** expired hygiene waivers remain below a defined maximum and are remediated within an agreed time window.
- **Topology compliance latency:** folder and path violations detected before merge for enforced path controls, or within one reporting cycle for advisory controls.
- **AI approval completeness:** high-risk AI actions have approval evidence coverage at or near 100%.
- **AI eval freshness:** promoted skills and promoted model changes have current eval results within an agreed freshness window.
- **Instruction consistency:** contradictory instruction layers between graph policy, SKILL.md, and repo custom instructions remain below a defined maximum.
- **Agent replay completeness:** high-risk agent sessions retain the minimum replay artifact set for the required retention period.
- **Governance overhead:** p95 hygiene plus AI-hygiene evaluation latency stays within the developer-experience budget set per repo class.

## Anti-Noise Doctrine

1. A control does not enter the plan unless it maps to a measurable failure class.
2. Advisory first is the default; strict mode is earned, not assumed.
3. The graph should verify parity with platform-native controls instead of cloning them poorly.
4. Controls must be path-scoped, repo-profile-aware, and explainable in one screen.
5. New controls should start with a small must-pass set and grow only from real failures.
6. A control that cannot be measured for benefit or friction is not ready for broad rollout.
7. Human override must exist, but override debt must be visible and expiring.
8. Documentation controls are useful only when they are structural and machine-checkable.
9. Agent outputs are untrusted until validated if they can cause side effects.
10. Repository cleanliness is a safety property, not a style preference, only when linked to reliability, security, or governance drift.

## Control Retirement Rules

- Retire a control when a stronger control fully subsumes it and the old control adds no unique detection value.
- Downgrade a control from enforced to advisory when false positives, latency cost, or developer friction exceed its measured prevention value.
- Remove a control that has no clear failure-class mapping after a defined review window.
- Re-scope a control when only a subset of repositories or action classes actually benefit from it.
- Require a sunset review for any temporary control added after an incident or bypass event.
- Preserve retired-control history in the graph so past policy decisions remain explainable during audits and replay.

## What Changed Relative to Your Drafts

### Retained as high-signal controls
- B1 Proof-of-Done Hygiene
- B2 Ownership Hygiene
- B3 Exception Hygiene
- B6 Security Baseline Hygiene
- B7 Control-Effectiveness Hygiene
- A2 Agent Approval Hygiene
- A3 AI Eval Regression Hygiene
- A6 AI Security Hygiene

### Retained but narrowed or staged
- B4 Drift Hygiene was narrowed to repository and claim-support drift so it does not duplicate core AnyGraph graph-truth work.
- B5 Cost/Latency Hygiene was retained but turned into explicit SLO and budget governance rather than generic telemetry.
- B8 README Hygiene, B9 Folder Topology Hygiene, B10 Doc-to-Code Link Hygiene, and B11 Template Hygiene were kept advisory-first and integrated into profile-based repo contracts.
- A1 Skill Contract Hygiene was expanded into a full skill registry plus invocation-precision testing.
- A4 Prompt/Skill Drift Control was merged into broader prompt and skill drift governance.
- A5 Evidence/Attribution Hygiene was split into an attribution contract plus unsupported-claim blockers.

### New controls added from research
- Policy bundle versioning and decision logs
- RepoHygieneProfile and bootstrap presets
- Platform parity checks for rulesets and branch settings
- SBOM and provenance availability tracking
- Tool permission model and sandbox boundaries
- Instruction sync between graph policy, SKILL.md, and repo custom instructions
- AI supply-chain hygiene for models, datasets, MCP servers, and plugins
- Agent session replay and artifact retention
- Control budgets and explicit retirement rules

## Source Set Used

- OpenSSF Scorecard: https://scorecard.dev/
- Open Source Project Security Baseline: https://baseline.openssf.org/
- SLSA Provenance: https://slsa.dev/provenance
- SLSA Levels: https://slsa.dev/spec/v1.0/levels
- in-toto: https://in-toto.io/
- in-toto Layout Creation Example: https://in-toto.readthedocs.io/en/latest/layout-creation-example.html
- GitHub Rulesets: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets
- GitHub Available Rules for Rulesets: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
- GitHub CODEOWNERS: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners
- GitHub Secret Scanning: https://docs.github.com/en/code-security/concepts/secret-security/about-secret-scanning
- GitHub Push Protection: https://docs.github.com/en/code-security/concepts/secret-security/about-push-protection
- GitHub Dependency Review: https://docs.github.com/en/code-security/concepts/supply-chain-security/about-dependency-review
- GitHub Dependency Graph and SBOM: https://docs.github.com/en/code-security/concepts/supply-chain-security/about-the-dependency-graph
- OPA Docs: https://www.openpolicyagent.org/docs
- OPA Decision Logs: https://www.openpolicyagent.org/docs/management-decision-logs
- Bazel: https://bazel.build/
- Bazel Hermeticity: https://bazel.build/basics/hermeticity
- Pants Effective Monorepos: https://www.pantsbuild.org/blog/2022/03/15/effective-monorepos-with-pants
- Pants Dependency Inference: https://www.pantsbuild.org/blog/2024/01/25/inspecting-dependency-inference-results
- Temporal Event History: https://docs.temporal.io/encyclopedia/event-history
- CamFlow: https://camflow.org/
- Google SRE Error Budget Policy: https://sre.google/workbook/error-budget-policy/
- Google SRE Canarying Releases: https://sre.google/workbook/canarying-releases/
- DORA Metrics: https://dora.dev/guides/dora-metrics/
- Four Keys: https://cloud.google.com/blog/products/devops-sre/using-the-four-keys-to-measure-your-devops-performance
- OWASP Top 10 for LLM Applications: https://owasp.org/www-project-top-10-for-large-language-model-applications/
- NIST AI RMF: https://www.nist.gov/itl/ai-risk-management-framework
- NIST AI RMF Playbook: https://www.nist.gov/itl/ai-risk-management-framework/nist-ai-rmf-playbook
- NIST SSDF: https://csrc.nist.gov/projects/ssdf
- OpenAI Evaluation Best Practices: https://developers.openai.com/api/docs/guides/evaluation-best-practices/
- OpenAI Testing Agent Skills with Evals: https://developers.openai.com/blog/eval-skills/
- OpenAI Practical Guide to Building Agents: https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/
- GitHub Copilot Repository Custom Instructions: https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions
- GitHub Copilot Coding Agent: https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent
- Hugging Face Model Cards: https://huggingface.co/docs/hub/model-cards
- Hugging Face Dataset Cards: https://huggingface.co/docs/hub/datasets-cards
