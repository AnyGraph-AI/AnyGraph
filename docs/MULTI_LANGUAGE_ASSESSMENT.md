# CodeGraph Universal Parser & Corpus Architecture — FINAL PLAN

**Date**: 2026-03-11
**Status**: All three models assessed (Watson + Grok + GPT Pro). Merged & ready.
**Goal**: Extend CodeGraph from TypeScript-only to universal reasoning graph (multi-language code + document corpora + structured corpora + plan graphs)

---

## Architecture Overview

CodeGraph becomes a **universal reasoning graph** with four graph domains:

| Domain | Purpose | Analogy |
|--------|---------|---------|
| **Code graphs** | Source code structure, calls, risk | Motor nervous system (what the body DOES) |
| **Corpus graphs** | Bible, Quran, structured knowledge | Memory (what the mind KNOWS) |
| **Document graphs** | Legal filings, investigative evidence | Sensory input (what the eyes SEE) |
| **Plan graphs** | Tasks, milestones, decisions, sprints | Prefrontal cortex (what to DO NEXT) |

**Strategic positioning** (GPT Pro, agreed):
- **Externally**: Safety-first multi-language code graph with provenance-capable corpus extensions
- **Internally**: Universal reasoning graph spanning code, documents, entities, events, evidence, and plans

---

## 1. Three-Tier Parser Architecture

**Source**: GPT Pro refined, Watson + Grok confirmed

Three tiers, not two. The distinction between compiler-backed and workspace-semantic is real.

### Tier 0 — Compiler-Backed (wraps the actual compiler)
Full RESOLVES_TO, typed CALLS, overload-aware, reproducible with buildContextHash.

| Language | Engine | Status | Notes |
|----------|--------|--------|-------|
| TypeScript | ts-morph | ✅ Production | Benchmark. 88.3% RESOLVES_TO |
| Java | Eclipse JDT Core | Planned | Spoon secondary, JavaParser+SymbolSolver lightweight fallback |
| Go | go/ast + go/packages + go/types | Planned | Native compiler libraries, NOT gopls (GPT corrected Grok) |
| C# | Roslyn | Planned | Direct ts-morph analogue for .NET |

### Tier 1 — Workspace-Semantic (language server / sidecar)
High-quality RESOLVES_TO, good CALLS, explicit confidence penalties for dynamic patterns.

| Language | Engine | Status | Notes |
|----------|--------|--------|-------|
| Python | CPython ast + Pyright sidecar | **NEXT** | Pyrefly benchmark lane, not default yet |
| Rust | rust-analyzer sidecar | Future | Only if Rust becomes strategic |

### Tier 2 — Structural (tree-sitter fallback)
CALLS/IMPORTS/CONTAINS by name-matching. No RESOLVES_TO. Advisory-only risk.

| Language | Engine | Status |
|----------|--------|--------|
| Rust | tree-sitter-rust | Planned (Phase 1) |
| C/C++ | tree-sitter-c/cpp | Planned |
| PHP | tree-sitter-php | Planned |
| Lua | tree-sitter-lua | Planned |
| Scala | tree-sitter-scala | Planned |
| Any new | tree-sitter-{lang} | Onboarding contract |

### Tier Metadata (persisted on every edge/node)
Essential fields (ship with these):
- `parserTier`: 'compiler' | 'workspace-semantic' | 'structural'
- `confidence`: 0.0–1.0
- `resolutionKind`: 'type-resolved' | 'name-match' | 'unresolved'
- `sourceRevision`: git commit hash
- `provenanceKind`: 'parser' | 'enrichment' | 'manual' | 'llm'

Extended fields (add incrementally):
- `parserEngine`, `parserVersion`, `buildContextHash`, `graphEpoch`, `sourceSpan`, `ingestRunId`, `manualLock`, `conflictSetId`, `verificationState`

### buildContextHash (GPT Pro insight — agreed)
Every semantic parser result keyed to its build environment:
- TS: tsconfig hash
- Python: execution-environment + import-path config
- Java: classpath / Maven / Gradle resolution state
- Go: module graph + build flags
- C#: solution/project graph

Without this, semantic facts are not reproducible.

### New Language Onboarding Contract (Tier 2 entry)
1. Tree-sitter grammar available
2. Declaration extractor implemented
3. Symbol normalization implemented
4. Confidence defaults defined
5. Gold-test corpus added

---

## 2. Parser Integration Layer (IR)

**Source**: GPT Pro (critical new insight — Watson + Grok missed this)

### The Rule
```
Parser → IR → Enrichment → Graph
```
**Do this BEFORE adding another major language.** Otherwise TS assumptions contaminate everything.

### IR v1 Schema

```
Artifact     { artifactId, projectId, kind, language, path, contentHash, sourceRevision }
Container    { containerId, artifactId, kind, name, fqName, parentContainerId, span }
Symbol       { symbolId, artifactId, containerId, kind, name, fqName, signatureHash, span, modifiers, visibility, isAsync, isGenerated }
Site         { siteId, artifactId, enclosingSymbolId, kind, span, rawText }
Entity       { observedEntityId, domain, entityType, normalizedName, aliases, sourceKey }
Assertion    { assertionId, subjectId, predicate, objectId, span, confidence, parserTier, parserEngine, resolutionKind, provenanceKind, ingestRunId }
```

### IR Edge Vocabulary (stable, small)
CONTAINS, DECLARES, IMPORTS, CALLS, RESOLVES_TO, REFERENCES, INHERITS, IMPLEMENTS, ANNOTATES, MENTIONS, QUOTES, PARAPHRASES, REGISTERED_BY, READS_STATE, WRITES_STATE, CO_CHANGES_WITH

### Why This Matters
1. Parsers stop knowing about Neo4j labels or Cypher shape
2. Enrichment rules become reusable across languages (HTTP handler registration, DI binding, ORM model relation)
3. Evaluation becomes comparable (same output contract for every parser)
4. Graph can evolve without forcing parser rewrites

### Compatibility
Keep existing Neo4j node labels and edge types. Add materialization stage: IR v1 → current operational graph. TypeScript keeps working while new parsers arrive.

### Framework Enrichments (GPT Pro insight — agreed)
Move Grammy registration decomposition, route detection, ORM inference OUT of the TS parser and INTO enrichment plugins that operate on IR. Prevents TS-specific assumptions from contaminating other parsers.

---

## 3. Four-Layer Graph Architecture

**Source**: GPT Pro (biggest missing subsystem from earlier analyses)

| Layer | Purpose | Mutability |
|-------|---------|------------|
| **Evidence** | Immutable observations from parsers, ingesters, LLM extractors, Git, humans | Append-only |
| **Canonical** | Current best supported view of entities and relations | Materialized from evidence |
| **Operational** | Risk scores, hotspots, projections, caches, query-optimized edges | Computed, ephemeral |
| **Agent Session** | Unsaved buffers, pending edits, candidate merges, what-if simulations | TTL, per-session |

**Critical rule**: Agents reason over canonical + operational layers. Every answer must be back-linkable to evidence.

### verificationState Values
- `verified_semantic` — compiler-backed, current revision
- `supported_semantic` — workspace-semantic, current revision
- `structural_only` — tree-sitter / name-match
- `stale` — source revision changed, not reindexed
- `conflicted` — multiple parsers disagree
- `human_locked` — manually set, not auto-overridable
- `quarantined` — flagged for review

---

## 4. Confidence-Aware Risk Engine

**Source**: GPT Pro, refined with Watson pushbacks

### Edge Weight Formula
```
effectiveEdgeWeight = baseConfidence × freshnessFactor × verificationFactor
```

| Parser Tier | Base Confidence |
|-------------|----------------|
| Compiler-backed semantic | 0.95–1.00 |
| Workspace-semantic | 0.80–0.95 |
| Structural name-match | 0.45–0.70 |
| LLM-extracted (uncorroborated) | 0.25–0.55 |
| Stale | multiply by 0.0–0.3 |

### Weighted Metrics
```
weightedFanIn = sum(incoming effectiveEdgeWeight)
weightedFanOut = sum(outgoing effectiveEdgeWeight)
weightedBlastRadius = path aggregation over reachable edges above threshold
```

### Agent Edit Gating Policy
| Mode | Requirements |
|------|-------------|
| **Autonomous edit** | Semantic coverage ≥ 0.80, stale files = 0, conflicts = 0, low-confidence blast contribution < 0.20 |
| **Assisted edit** | Semantic coverage ≥ 0.50, explicit caution banner, tests/review mandatory |
| **Advisory only** | Below thresholds — read-only analysis |

### simulate_edit Tier Awareness
- Semantic tiers: traverse resolved CALLS, IMPORTS, INHERITS, IMPLEMENTS, registrations, co-change
- Structural tiers: traverse containment, obvious imports, name-match calls only → label as "topology-weighted impact" not "semantic blast radius"

### Hard Rules
1. **No silent staleness** — if source revision changed and subgraph not reindexed, return STALE_GRAPH
2. **No silent parser gaps** — parser failure = coverageGap=true, not zero risk (GPT Pro insight)
3. **No unsupported LLM facts in edit policy** — LLM edges enrich search, cannot drive autonomous edits
4. **No unsaved-buffer contamination** — live editor overlays in agent session layer only, with TTL

### MCP Tool Response Fields (all agent-facing tools)
- `graphEpoch`
- `sourceRevision`
- `minConfidence`
- `coverageState`
- `supportingEvidenceCount`

---

## 5. Python Semantic Analysis (First New Language)

**Source**: All three models agree. GPT Pro has the most detailed architecture.

### Production Stack: CPython ast + Pyright sidecar

**Architecture**:
1. **Workspace discovery** — resolve roots, execution environments, src layout, extraPaths, venv, site-packages, namespace packages
2. **Module graph** — build concrete module/dependency graph before call resolution (mandatory in Python — import shape changes semantics)
3. **AST pass** — extract functions, classes, methods, decorators, imports, async flags, calls, attribute accesses, comprehensions, context managers, local scopes
4. **Semantic pass** — Pyright sidecar resolves imports, definitions, references, types. For `foo()` resolve callee token. For `obj.method()` resolve base object type → map through class/MRO
5. **Uncertainty accounting** — confidence penalties for: getattr/setattr, `__getattr__`, monkeypatching, dynamic imports, wildcard imports, metaclasses, reflection, module-level side effects, stub-only targets
6. **IR emission** — emit both resolved AND unresolved assertions with explicit reasons

### Python Tool Rankings
1. **Pyright** — production default (full cross-file resolution, type inference on untyped code)
2. **Pyrefly** — benchmark lane only (Meta, Rust-based, Beta, config surface still early-development)
3. **ty (astral-sh)** — watch (Ruff/uv creators, Rust-based, needs maturity check)
4. **Jedi** — cross-checker for goto/references
5. **Rope** — refactoring-oriented occurrence analysis
6. **astroid/mypy** — CI signal, not graph backend

### Design Decision
Treat Pyright as a **sidecar service** (long-lived worker process), not a direct library import. The documented public surface is CLI + language services — a sidecar is the safer engineering contract.

---

## 6. Other Language Parsers

### Java (Tier 0)
- **Primary**: Eclipse JDT Core — resolves bindings, connects names/types to program elements
- **Secondary**: Spoon — cleaner source analysis / transformation API
- **Lightweight**: JavaParser + JavaSymbolSolver — easier embedding, less compiler-native
- **Fallback**: tree-sitter-java (Tier 2)

### Go (Tier 0)
- **Primary**: Native Go sidecar on go/ast + go/packages + go/types (compiler libraries)
- **Optional**: gopls as workspace-semantic compatibility mode
- **NOT**: gopls as primary — don't build production parser around editor server when compiler libraries exist (GPT corrected Grok)

### C# (Tier 0)
- **Engine**: Roslyn — direct ts-morph analogue for .NET
- **Priority**: After Python/Java/Go, only if demand exists

### Rust (Tier 2 → conditional Tier 1)
- **Phase 1**: tree-sitter-rust (ship fast)
- **Phase 2**: rust-analyzer sidecar (only if Rust becomes strategic)

### C/C++ (Tier 2, conditional Tier 0)
- **With build context**: Clang LibTooling / LibASTMatchers + clangd sidecar
- **Without build context**: Tier 2 structural only
- **Watson pushback**: Ship Tier 2 only until demand materializes. Clang is a massive dependency.

### PHP, Lua, Scala (Tier 2 only)
- tree-sitter fallback. Evaluate PHPStan/Psalm later if PHP becomes strategic.

---

## 7. Entity Resolution Across Graph Domains

**Source**: GPT Pro (strongest entity resolution design)

### Two-Level Identity System
- **ObservedEntity**: What a source actually said or parser actually found (immutable)
- **CanonicalEntity**: Best current hypothesis about the real thing (materialized)

**Never delete ObservedEntity records. Never do destructive merges as first move.**

### Resolution Flow
1. **Deterministic normalization** — case, punctuation, honorifics, org suffixes, transliterations, Git author forms, scripture naming variants
2. **Candidate generation** — exact normalized matches, alias tables, domain-specific keys, constrained fuzzy search
3. **Similarity scoring** — blend deterministic features, fuzzy distance, embedding similarity, graph-topology features
4. **Decision states** — REJECTED_MATCH → CANDIDATE_MATCH → SUPPORTED_MATCH → ACCEPTED_CANONICALIZATION
5. **Human review** — for cross-domain merges and high-value investigative identities

### Graph Shape
```cypher
(:ObservedEntity)-[:CANDIDATE_SAME_AS {score, evidence...}]->(:CanonicalEntity)
(:ObservedEntity)-[:ACCEPTED_AS]->(:CanonicalEntity)
(:ObservedEntity)-[:HAS_ALIAS]->(:NameVariant)
```

### Namespace Discipline
Code author ≠ biblical figure ≠ legal witness even if same surface name. Observed IDs are domain-scoped. Cross-domain canonicalization requires stronger evidence than same-domain.

---

## 8. Document / Corpus Pipeline

### Type A: Structured Corpora (Bible, Quran, etc.)
- Keep custom Python ingesters (stable schema, stable identifiers, no LLM needed)
- Add: stable source keys (book:chapter:verse), recordHash for change detection
- MERGE by stable key, update only changed records
- Preserve manual annotations via provenance rules (AUTO_GENERATED vs MANUAL edge labels)
- IngestRun tracking — know which auto assertions came from which source snapshot

### Type B: Legal / Investigative Corpus (Epstein)
**Bootstrap from public artifacts, LLM only for deltas** (Grok + GPT Pro agree):

1. **Bootstrap** — import rhowardstone SQLite + curated KG JSON into observation layer (NOT directly into canonical entities)
2. **Evidence enrichment** — add page-level spans, redaction metadata, media/transcript artifacts, document-class labels
3. **Cheap first-pass** — regex, dictionaries, tables, exact aliases, local NER, pattern extraction, existing metadata
4. **Targeted LLM** — only for ambiguous people, financial relationships, investigator-selected documents
5. **Write observations, not truth** — every extracted relation lands as provenance-scoped evidence with confidence and source span

**Cost**: Near zero for bootstrap (already have rhowardstone mounted). LLM budget only for deltas and ambiguity.

---

## 9. Watcher Architecture

**Source**: GPT Pro design, Watson pragmatism on scale

### Current State (keep)
One watcher service (`watch-all.ts`), discovers projects from Neo4j, in-process debounced queue. This is fine at 7 projects.

### Target State (when needed)
Thin watcher → fingerprinting + debounce → event bus / queues → workers → graph writer

Four lanes (add when contention appears):
- `code-fast-lane`: changed source files → parser workers → incremental graph update
- `corpus-lane`: CSV/JSON/text changes → row-diff ingest
- `document-lane`: PDF/manifests → batched extraction (never synchronous)
- `backfill-lane`: long-running reprocessing, re-resolution

**Watson pushback**: Redis/Temporal is premature at our scale. Ship with in-process queue. Add infrastructure when we hit 50+ projects or contention.

### Project Node Extension
```cypher
(p:Project {
  projectId: 'proj_bible_kjv',
  type: 'code' | 'corpus' | 'document' | 'plan',
  parserTier: 'compiler' | 'workspace-semantic' | 'structural' | 'custom' | 'llm',
  watchPath: '/path/to/data/',
  watchGlob: '*.csv',
  ingestCommand: 'python3 /path/to/ingest.py'
})
```

---

## 10. Plan Graphs (Fourth Domain)

**Source**: Watson + Jonathan (session discussion)

### Why
Without plan tracking in the graph, completion state lives only in human memory and flat files. Both drift.

### Schema
```
Node types: Task, Milestone, Sprint, Decision, Blocker, Research
Edge types: BLOCKS, PART_OF, DEPENDS_ON, MODIFIES, TARGETS, BASED_ON, SUPERSEDES
```

### Cross-Domain Edges
```cypher
(t:Task)-[:MODIFIES]->(sf:SourceFile)           // Plan → Code
(s:Sprint)-[:TARGETS]->(d:Document)              // Plan → Evidence
(d:Decision)-[:BASED_ON]->(r:Research)           // Plan → Research
```

### Queries This Enables
- `MATCH (t:Task {status: 'in_progress'}) WHERE NOT (t)-[:COMPLETED]->() RETURN t` — abandoned tasks
- Priority conflict detection when new work arrives
- Session cold start: query in-progress tasks instead of reading 5 files
- Cross-project awareness: "does starting Python parser block Groff G7?"

---

## 11. Graph Scalability

**Source**: GPT Pro (agreed, with Watson timing corrections)

| Scale | Strategy |
|-------|----------|
| Up to ~20M nodes | One operational DB + hot/cold separation. Index aggressively. |
| ~20M–100M | Split evidence/embeddings away from operational graph |
| 100M+ | Domain/tenant sharding, composite databases (Enterprise only, NOT Aura), federated queries |

### Key Rules
- Don't co-locate vector workloads with hot operational graph (vector indexes use OS memory, not page cache)
- Don't materialize every weak relation — bounded CO_CHANGES_WITH, bounded CANDIDATE_MATCH only
- GDS projections for centrality/hotspots — only when OLTP queries get slow (NOT yet at 50K nodes)

---

## 12. Existing OSS — What to Steal

| Source | What to Take | License |
|--------|-------------|---------|
| **ChrisRoyse/CodeGraph** | Python parser scaffolding, two-pass analysis pattern | MIT |
| **code-graph-rag** | Tree-sitter onboarding patterns, unified schema reference | Open source |
| **CodeGraphContext** | Grammar/onboarding references | Open source |
| **mufasadb/code-grapher** | Python entity classification system (25+ types) | Open source |
| **rhowardstone** | Epstein corpus bootstrap (already mounted) | Public |
| **dleerdefi/epstein-network-data** | Flight log / black book Neo4j reference | Open source |

**Rule**: Mine for parser scaffolding and patterns. Do NOT adopt their architecture. Our safety layer (confidence-weighted risk, edit gating, provenance) is the moat.

---

## 13. Implementation Roadmap

### Sprint 1: IR Foundation (Days 1-2)
- [ ] Define IR v1 JSON schema and parser contract
- [ ] Refactor current TS pipeline: parser output → IR → enrichment → graph
- [ ] Move Grammy enrichments out of parser into IR-level enrichment plugins
- [ ] Add essential metadata fields to Neo4j (parserTier, confidence, resolutionKind, sourceRevision, provenanceKind)

### Sprint 2: Python + Confidence Engine (Days 3-5)
- [ ] Build PythonParser v1: ast extraction + Pyright sidecar
- [ ] Fork ChrisRoyse Python parser scaffolding as starting point
- [ ] Implement weighted confidence propagation in pre_edit_check and simulate_edit
- [ ] Add stale-graph blocking and coverage-gap reporting
- [ ] Add parser gold-test harness for TypeScript + Python

### Sprint 3: Corpus + Entity Resolution (Days 6-8)
- [ ] Add record-hash diff ingestion for structured corpora (Bible)
- [ ] Wire watch-all.ts to handle corpus project types
- [ ] Build ObservedEntity / CanonicalEntity identity model
- [ ] Import Epstein bootstrap into observation layer
- [ ] Preserve manual annotations during re-ingest via provenance rules

### Sprint 4: Breadth + Plan Graph (Days 9-11)
- [ ] Land tree-sitter Tier 2 for Rust, PHP, Lua (3-4 languages)
- [ ] Build plan graph parser (PLAN.md → Task/Milestone nodes)
- [ ] Add plan ↔ code cross-domain edges
- [ ] Evaluation dashboards: import resolution precision, call-target precision, stale-graph refusal rate

### Sprint 5: Second Semantic Wave (Days 12-16)
- [ ] Build JavaParser service with JDT Core
- [ ] Build GoParser service using go/packages + go/types + go/ast
- [ ] Add project/domain hot-cold separation if node count warrants
- [ ] Promote parsers only after gold-suite + agent-safety metrics pass

### Sprint 6: Polish + Ship (Days 17-20)
- [ ] C# Roslyn parser (if demand exists)
- [ ] Entity resolution cross-domain (code authors ↔ legal witnesses)
- [ ] Second-source verification where cheap
- [ ] GitHub push + npm publish
- [ ] Documentation: README, CHANGELOG, SKILL.md updates

---

## 14. Final Decision Log (Watson + Grok + GPT Pro Consensus)

| Decision | Choice | Source |
|----------|--------|--------|
| Parser architecture | Three tiers: compiler, workspace-semantic, structural | GPT Pro (refined Watson/Grok) |
| Integration boundary | Mandatory Parser → IR → Enrichment → Graph | GPT Pro (new insight) |
| Core moat | Edit simulation, blast radius, agent safety, provenance | All three agree |
| Graph layers | Evidence → Canonical → Operational → Session | GPT Pro (new insight) |
| First new language | Python via ast + Pyright sidecar | All three agree |
| Pyrefly status | Benchmark lane, not default (Beta, early-dev config) | GPT Pro + Watson verified |
| Java backend | Eclipse JDT Core primary; Spoon secondary | GPT Pro + Grok agree |
| Go backend | Native go/ast + go/packages + go/types; NOT gopls primary | GPT Pro corrected Grok |
| C# backend | Roslyn | All three agree |
| Rust plan | Tier 2 now; rust-analyzer sidecar only if demand justifies | All three agree |
| C/C++ plan | Tier 2 only until demand (Watson: Clang too heavy for now) | Watson pushback on GPT |
| Tree-sitter role | Universal fallback + onboarding substrate, never primary | All three agree |
| OSS reuse | ChrisRoyse for scaffolding only; code-graph-rag for patterns | GPT Pro refined |
| Structured corpora | Custom ingesters + record hashes + annotation preservation | All three agree |
| Investigative corpora | Bootstrap from public SQLite/KG; LLM only for deltas | Grok + GPT Pro agree |
| Entity resolution | ObservedEntity → CanonicalEntity, never destructive | GPT Pro (new design) |
| Watcher design | One service, in-process queue; Redis when needed | Watson pragmatism on GPT design |
| Agent edit gating | Confidence-aware, freshness-aware, coverage-aware | GPT Pro (critical new subsystem) |
| Risk engine | Weighted edge confidence × freshness × verification | GPT Pro |
| Unknown = not zero | Parser gaps are coverage gaps, not safe zones | GPT Pro (insight) |
| Scaling plan | Hot/cold at ~20M; multi-DB at ~100M | GPT Pro |
| Plan graphs | Fourth domain: tasks, milestones, cross-domain edges | Watson + Jonathan |
| Promotion rule | No parser "production" without gold tests + safety thresholds | GPT Pro |
| Timeline | Agent-swarm accelerated: ~20 working days, not 6 months | Watson (corrected all) |
| Strategic positioning | Narrow externally, broad internally | GPT Pro (agreed) |
