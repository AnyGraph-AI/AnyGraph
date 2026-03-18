# PLAN_FORMAT.md — Plan File Specification

**This is the contract between plan authors and the plan parser.**

The plan parser (`src/core/parsers/plan-parser.ts`) ingests markdown files from `plans/` into Neo4j as Task, Milestone, Sprint, Decision, and PlanProject nodes. If your markdown doesn't match this spec, nodes get missed, dependencies don't resolve, and the graph can't track your work.

Read this before writing or editing any plan file. No exceptions.

---

## Directory Structure

```
plans/
  project-name/          ← directory name becomes projectId: plan_project_name
    PLAN.md              ← main plan file (any name works)
    ROADMAP.md           ← additional plan files (all .md files are parsed)
    sprints/
      sprint-1.md        ← subdirectories work too (recursive glob)
```

**Project ID rule:** The directory name is slugified: hyphens become underscores, prefixed with `plan_`.
- `plans/codegraph/` → `plan_codegraph`
- `plans/bible-graph/` → `plan_bible_graph`
- `plans/runtime-graph/` → `plan_runtime_graph`

Every `.md` file in the directory (at any depth) is parsed as part of that project.

---

## Milestones

Milestones are the primary organizational unit. They become `Milestone` nodes linked to the `PlanProject` via `PART_OF`.

### Header format

```markdown
### Milestone RF-2 — Enforcement Gate ✅
### Milestone VG-1 — Schema + Identity Foundation ✅
### Milestone 3: Something planned
## Milestone CA-1 — Dependency Integrity Gate ✅
```

**Regex:** `^###?\s+Milestone\s+([A-Za-z0-9][A-Za-z0-9_-]*)(?:\s*[:\-—]\s*(.*))?$`

**Rules:**
- Must start with `##` or `###` followed by the word `Milestone` (case-insensitive)
- Milestone code is the first token after "Milestone" — alphanumeric, hyphens, underscores allowed (e.g., `RF-2`, `VG-1`, `CA-1`, `3`)
- Title follows after `:`, `-`, or `—` separator
- Emoji in the title is stripped from the stored name

**Status from emoji (in the header line):**
| Emoji | Status |
|-------|--------|
| ✅ | `done` |
| 🔜 | `in_progress` |
| _(none)_ | `planned` |

### Spec text (milestone description)

Prose lines between a milestone header and the first task/sub-section are captured as `specText` on the Milestone node. This is how you describe what the milestone means and why it matters.

```markdown
### Milestone VG-3 — Scope-Aware Resolver ✅

Compute scope completeness from scan metadata, enforce "unknown is not zero" by
upgrading clean-but-unscanned critical targets to UNKNOWN_FOR, cap evidence grades
for runs with suppressed errors, and detect contradictions across evidence sources.

- [x] Compute `scopeCompleteness` from included/excluded/error metadata
```

The parser captures everything between the header and the first checkbox/section as `specText`. Dependency directives (`DEPENDS_ON`, `NO_DEPENDS_OK`) on standalone lines are filtered out of spec text.

**Write spec text for every milestone.** It's what agents and humans read to understand the goal without parsing individual tasks.

---

## Sprints

```markdown
### Sprint 1: Setup and scaffolding
### Sprint 3: Gate wiring and hardening
```

**Regex:** `^###?\s+Sprint\s+(\d+)[\s:]*(.*)$`

**Rules:**
- `##` or `###` followed by `Sprint` and a number
- Title follows after `:` or whitespace
- Creates a `Sprint` node linked to the project via `PART_OF`

---

## Tasks (Checkboxes)

Tasks are the atomic work units. They become `Task` nodes linked to their parent section (milestone, sprint, or generic section) via `PART_OF`.

```markdown
- [x] Implement SARIF importer for CodeQL results       ← done
- [ ] Wire advisory gate to CI pipeline                  ← planned
  - [ ] Add timeout configuration                        ← sub-task (indented 2+ spaces)
  - [x] Write integration test                           ← done sub-task
```

**Regex:**
- Done: `^(\s*)- \[x\]\s+(.+)$`
- Planned: `^(\s*)- \[ \]\s+(.+)$`

**Rules:**
- `- [x]` = done, `- [ ]` = planned (the space matters — `[]` won't match)
- Indentation of 2+ spaces marks a sub-task (`isSubTask: true`)
- Task text is everything after the checkbox
- Tasks are assigned to the most recent milestone, sprint, or section header above them

**What goes in task text:**
- Describe the work, not the checkbox. "Implement X" not "Done"
- Reference files with backticks: `` `src/core/parser.ts` ``
- Reference functions with parens: `` `parseFile()` ``
- Reference projects with IDs: `proj_c0d3e9a1f200`
- These cross-references are automatically extracted and resolved against the code graph

---

## Tasks (Table Format)

For structured task lists (e.g., gap analysis), table format is also supported:

```markdown
| Task description | Gap # | LOC | Risk |
|-----------------|-------|-----|------|
| Extract DCA handler to module | #3 | 200 | HIGH |
| Add type guards for trade params | #7 | 50 | MEDIUM |
```

**Regex:** `^\|\s*(.+?)\s*\|\s*(#?\d+|—|-)\s*\|\s*(\d+|—|-)\s*\|\s*(.+?)\s*\|$`

**Rules:**
- Header row and separator row (`---`) are automatically skipped
- Creates `Task` nodes with additional properties: `gapNumber`, `estimatedLOC`, `risk`
- Use `—` or `-` for empty fields

---

## Dependencies

Dependencies create `DEPENDS_ON` and `BLOCKS` edges between tasks/milestones. These are what make the graph understand execution order.

### Directive format

Place dependency directives on the line(s) immediately after a task or milestone header:

```markdown
- [x] Validate invariant: materialization idempotency
  DEPENDS_ON: Attach attestation references on VerificationRun

### Milestone VG-3 — Scope-Aware Resolver ✅

  DEPENDS_ON: Attach attestation references on VerificationRun
```

**Supported formats:**
```
DEPENDS_ON: <exact task or milestone title>
DEPENDS_ON <exact task or milestone title>
**DEPENDS_ON** <exact task or milestone title>
BLOCKS: <exact task or milestone title>
BLOCKS <exact task or milestone title>
**BLOCKS** <exact task or milestone title>
```

Can also appear inside checkbox lines:
```
- [ ] **DEPENDS_ON** Task X
```

**Multiple dependencies:** Use semicolons to separate multiple targets on one line, or use multiple lines:

```markdown
- [x] Meet pilot threshold: false-positive rate <= 10%
  DEPENDS_ON: Validate invariant: materialization idempotency; Validate invariant: project-scope integrity
```

Or:
```markdown
- [x] Meet pilot threshold: false-positive rate <= 10%
  DEPENDS_ON: Validate invariant: materialization idempotency
  DEPENDS_ON: Validate invariant: project-scope integrity
```

**⚠️ Do NOT use commas as separators.** Task names commonly contain commas (e.g., "Add exception enforcement pass (expiry, approval mode, ticket linkage)"). The parser splits on semicolons only.

### Code Evidence Exceptions (`NO_CODE_EVIDENCE_OK`)

For done tasks that intentionally have no code artifact (manual verification steps, config changes, meetings), use `NO_CODE_EVIDENCE_OK` to suppress false-positive evidence gaps.

**Format:** `NO_CODE_EVIDENCE_OK(reason)`

```markdown
- [x] Run precompute once and verify: 337 SourceFiles, 769 Functions, all scored. NO_CODE_EVIDENCE_OK(manual-verification-step)
```

**Rules:**
- Inline in checkbox text or on standalone next line
- `reason` must describe why no code artifact exists
- Sets `noCodeEvidenceOK` property on Task node
- Evidence gap queries filter `WHERE t.noCodeEvidenceOK IS NULL` to exclude these tasks
- Don't use this to skip annotation — only for tasks that genuinely produce no files

### Dependency Exceptions (`NO_DEPENDS_OK`)

For tasks that intentionally have no dependencies (e.g., foundational root tasks), use the `NO_DEPENDS_OK` directive to suppress dependency hygiene violations.

**Format:** `NO_DEPENDS_OK(reason|expires:YYYY-MM-DD)`

```markdown
### Milestone VG-1 — Schema + Identity Foundation

NO_DEPENDS_OK(foundational-root|expires:2026-12-31)

- [ ] Define core schema
- [ ] Implement identity resolver
  DEPENDS_ON: Define core schema
```

**Rules:**
- `reason` must be at least 3 characters — explain why no dependency is needed
- `expires` must be a future ISO date — exceptions don't live forever
- The verifier (`npm run plan:deps:verify`) checks both fields; malformed exceptions are violations
- **Scope:** Currently enforced on `DL-*` and `GM-*` milestones in `plan_codegraph`. The first non-done task in each milestone gets a "starter allowance" (no dependency required). All other planned tasks must have `DEPENDS_ON` or `NO_DEPENDS_OK`.
- **Strict mode:** Set `STRICT_SCOPED_DEPENDS_ON=true` to fail the build on missing dependencies (default: report only)

### Resolution

Dependencies resolve by matching the target text against existing Task/Milestone node names in the graph. Resolution uses scored matching:
1. Exact ID match (100 points)
2. Same project (30 points)
3. Exact name match, case-insensitive (20 points)
4. Milestone number match, e.g., `M1` → Milestone with `number: 1` (15 points)
5. Milestone hint in name (10 points)

**Best practice:** Use the exact task name as it appears in the checkbox text. Copy-paste to avoid typos.

---

## Decisions

Decision tables capture architectural choices. They become `Decision` nodes.

```markdown
## Architecture Decisions

| Decision | Choice |
|----------|--------|
| Parser tier for TypeScript | ts-morph (Tier 0) — semantic, not syntactic |
| IR before multi-language | Yes |
| Python parser approach | CPython ast + Pyright |
```

**Rules:**
- Table must be under a section header containing the word "decision" (case-insensitive)
- Two-column format: Decision | Choice (rationale belongs in spec text, not the table)
- Three-column format also accepted: Decision | Choice | Rationale (third column optional)
- Header and separator rows are automatically skipped
- Creates `Decision` nodes linked to the project via `PART_OF`

---

## Sections (Generic H2)

Any `##` header that isn't a milestone or sprint creates a `Section` node:

```markdown
## Thesis
## Node Types
## Edge Types
## Phased Execution Plan
```

Tasks under these sections are linked to the section via `PART_OF`. Sections themselves link to the project.

### H3 Sub-sections

`###` headers (that aren't milestones or sprints) update the current section key for task grouping but don't create separate nodes:

```markdown
### Week 1 — Foundations
- [ ] Task under this sub-section
```

---

## Cross-References (Automatic)

The parser automatically extracts references from task text. These are resolved against the code graph during enrichment to create `HAS_CODE_EVIDENCE` edges.

| Pattern | Type | Example |
|---------|------|---------|
| Backtick file path | `file_path` | `` `src/core/parser.ts` `` |
| Bare file path | `file_path` | `src/core/parser.ts` (no backticks, recognized extensions) |
| Function call | `function` | `` `parseFile()` `` |
| Project ID | `project_id` | `proj_c0d3e9a1f200` |
| EFTA number | `efta` | `EFTA01234567` |

**Recognized file extensions:** `.ts`, `.js`, `.py`, `.java`, `.go`, `.rs`, `.md`, `.json`, `.csv`, `.sql`, `.toml`, `.yaml`, `.yml`, `.sh`

**How enrichment works:** After parsing, `enrichCrossDomain()` resolves file/function references against actual `SourceFile` and `Function` nodes in the code graph. Matched references create `HAS_CODE_EVIDENCE` edges. This is how the plan graph answers "is this task actually done?" — if the code exists, the evidence edge exists.

### Artifact Annotation (Step 7b in WORKFLOW.md)

When marking a task done, **append backtick references** to every file, function, and test artifact produced. This is the receipt system — it tells the graph exactly what code a task created.

**What to annotate:**
- Source files created or modified: `` `PainHeatmap.tsx` ``, `` `queries.ts` ``
- Functions/components created: `` `PainHeatmap` ``, `` `computeBasePain` ``
- Test files: `` `ui2-pain-heatmap.test.ts` ``
- Key test names in parentheses after the test file

**Example:**
```markdown
- [x] Build Recharts Treemap component. Created `PainHeatmap.tsx` with `PainHeatmap` component. Updated `page.tsx` `Dashboard`. Added `painHeatmap` query to `queries.ts`. Tests: `ui2-pain-heatmap.test.ts` (`exports a PainHeatmap component`).
```

**Why it matters:** Without annotation, evidence linking relies on fuzzy keyword matching. With annotation, the graph gets surgical links. When M8 (evidenceRole semantics) lands, these annotations will automatically classify as `target` (planned) or `proof` (done + verified).

---

## Files Touched Sections

```markdown
### Files touched:
- `src/core/ir/ir-materializer.ts`
- `src/core/parsers/plan-parser.ts`
```

Lines under a `### Files touched:` header are parsed for file cross-references and attached to the current section.

---

## Stable IDs

Node IDs are generated from **structural position**, not content:

```
stableId(projectId, nodeType, filePath, sectionKey, ordinal)
```

**What this means:**
- Editing task text → same ID → properties update in place (MERGE)
- Checking/unchecking a checkbox → same ID → status updates in place
- Reordering tasks within a section → ordinals shift → IDs change
- Adding a task in the middle → downstream ordinals shift

**Design intent:** Task identity IS its position within a section. If you move a task, it becomes a different node. If you edit its text, it stays the same node.

---

## Plan-to-Code Project Mapping

The enrichment step needs to know which plan project maps to which code project. This is configured in `config/plan-code-project-map.json`:

```json
{
  "plan_codegraph": "proj_c0d3e9a1f200",
  "plan_godspeed": "proj_60d5feed0001",
  "plan_bible_graph": "proj_0e32f3c187f4",
  "plan_plan_graph": "proj_c0d3e9a1f200",
  "plan_runtime_graph": "proj_c0d3e9a1f200"
}
```

If your plan project isn't in this map, cross-domain evidence edges won't be created.

---

## What the Parser Ignores

- Lines that don't match any pattern (prose, blank lines, non-checkbox bullets)
- Code blocks (not explicitly skipped — but no pattern matches inside them)
- Links, images, HTML
- Anything above the first milestone/sprint/section header (good for preamble/thesis)

This means your design docs, rationale sections, and narrative prose can live in the same file as your executable checklist. The parser extracts structure; it ignores everything else.

---

## Template

```markdown
# Project Name — One-Line Description

## Context

Why this project exists. What problem it solves. Background.
(Parser ignores this — it's for humans and agents.)

## Architecture Decisions

| Decision | Choice |
|----------|--------|
| Key decision 1 | What we chose |
| Key decision 2 | What we chose |

## Execution Checklist

### Milestone 1 — Foundation ✅

Establish the core schema and scaffolding. This milestone creates
the base that everything else builds on.

- [x] Define node/edge schema
- [x] Implement parser for input format
- [x] Write integration tests
  DEPENDS_ON: Implement parser for input format

### Milestone 2 — Core Logic 🔜

Build the main processing pipeline on top of the foundation.

  DEPENDS_ON: Write integration tests
- [x] Implement resolver module (`src/core/resolver.ts`)
- [ ] Add confidence scoring
  DEPENDS_ON: Implement resolver module (`src/core/resolver.ts`)
- [ ] Wire into enrichment pipeline
  DEPENDS_ON: Add confidence scoring

### Milestone 3 — Gate Integration

Wire outputs into the pre-edit gate and CI policy.

  DEPENDS_ON: Wire into enrichment pipeline
- [ ] Add advisory gate mode
- [ ] Add assisted gate mode
  DEPENDS_ON: Add advisory gate mode
- [ ] Measure false-positive rate over 2 cycles
  DEPENDS_ON: Add assisted gate mode
- [ ] Promote to enforced mode
  DEPENDS_ON: Measure false-positive rate over 2 cycles

### Milestone DF-1 — Deferred: Nice-to-Have

Things we might do later. (DF- is a naming convention, not parser-enforced.)

- [ ] Fancy visualization dashboard
- [ ] Multi-language support
```

---

## Reference: Gold Standard

The best existing plan file to study is:

**`plans/codegraph/VERIFICATION_GRAPH_ROADMAP.md`**

It demonstrates:
- Design context in sections 1-18 (parser ignores gracefully)
- Milestone spec text explaining purpose before tasks
- Explicit per-task `DEPENDS_ON` directives
- Cross-references to source files via backtick paths
- Milestone dependency chains
- Decision tables
- Clear status tracking with emoji

---

## Common Mistakes

| Mistake | What Happens | Fix |
|---------|-------------|-----|
| `- []` instead of `- [ ]` | Task not parsed | Add the space: `- [ ]` |
| `- [X]` (capital X) | Task not parsed | Use lowercase: `- [x]` |
| Comma-separated dependencies | Parser splits wrong, names contain commas | Use semicolons or separate lines |
| Dependency target doesn't match any task name | Edge not created, shows as unresolved | Copy-paste exact task text |
| Tasks not under any section header | Tasks orphaned to project root | Add a milestone or section header above |
| Missing plan-code project map entry | No cross-domain evidence edges | Add entry to `config/plan-code-project-map.json` |
| File path without recognized extension | Cross-reference not extracted | Use a recognized extension or backtick format |
| Done task has no code evidence | Shows as evidence gap in queries | Add backtick file/function refs, or `NO_CODE_EVIDENCE_OK(reason)` if no artifact exists |
| `NO_CODE_EVIDENCE_OK` used to skip annotation | Hides real gaps | Only for tasks that genuinely produce no files (manual verification, config, meetings) |
