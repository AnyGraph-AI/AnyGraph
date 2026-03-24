# Plan File Specification — Parser Contract

_Load on demand. This is the contract between plan authors and the plan parser._

The plan parser (`src/core/parsers/plan-parser.ts`) ingests markdown files from `plans/` into Neo4j as Task, Milestone, Sprint, Decision, and PlanProject nodes. If your markdown doesn't match this spec, nodes get missed, dependencies don't resolve, and the graph can't track your work.

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

**Project ID rule:** Directory name slugified: hyphens → underscores, prefixed `plan_`.
- `plans/codegraph/` → `plan_codegraph`
- `plans/bible-graph/` → `plan_bible_graph`

Every `.md` file in the directory (at any depth) is parsed.

---

## Milestones

**Regex:** `^###?\s+Milestone\s+([A-Za-z0-9][A-Za-z0-9_-]*)(?:\s*[:\-—]\s*(.*))?$`

```markdown
### Milestone RF-2 — Enforcement Gate ✅
### Milestone VG-1 — Schema + Identity Foundation ✅
## Milestone CA-1 — Dependency Integrity Gate ✅
```

**Rules:**
- `##` or `###` + "Milestone" (case-insensitive) + code (alphanumeric/hyphens/underscores)
- Title after `:`, `-`, or `—` separator
- Emoji stripped from stored name

**Status from emoji:**

| Emoji | Status |
|-------|--------|
| ✅ | `done` |
| 🔜 | `in_progress` |
| _(none)_ | `planned` |

### Spec Text

Prose between milestone header and first task/sub-section → captured as `specText`. Write spec text for every milestone.

```markdown
### Milestone VG-3 — Scope-Aware Resolver ✅

Compute scope completeness from scan metadata, enforce "unknown is not zero."

- [x] Compute `scopeCompleteness` from included/excluded/error metadata
```

---

## Sprints

**Regex:** `^###?\s+Sprint\s+(\d+)[\s:]*(.*)$`

```markdown
### Sprint 1: Setup and scaffolding
```

---

## Tasks (Checkboxes)

**Regex:** `^(\s*)- \[x\]\s+(.+)$` (done) / `^(\s*)- \[ \]\s+(.+)$` (planned)

```markdown
- [x] Implement SARIF importer       ← done
- [ ] Wire advisory gate             ← planned
  - [ ] Add timeout configuration    ← sub-task (indented 2+)
```

**Rules:**
- `- [x]` = done, `- [ ]` = planned (space matters — `[]` won't match, `[X]` won't match)
- 2+ space indent = sub-task
- Tasks assigned to nearest milestone/sprint/section above
- Keep checkbox line short; put long rationale in continuation lines

**Continuation lines:** `Details:` or `EVIDENCE:` prefixes are parsed for backtick cross-references.

---

## Tasks (Table Format)

```markdown
| Task description | Gap # | LOC | Risk |
|-----------------|-------|-----|------|
| Extract DCA handler to module | #3 | 200 | HIGH |
```

Header and separator rows auto-skipped.

---

## Dependencies

### Directive Format

```markdown
- [x] Validate invariant
  DEPENDS_ON: Attach attestation references

### Milestone VG-3 — Scope-Aware Resolver ✅
  DEPENDS_ON: Attach attestation references
```

**Supported formats:**
```
DEPENDS_ON: <exact task or milestone title>
DEPENDS_ON <exact task or milestone title>
**DEPENDS_ON** <exact task or milestone title>
BLOCKS: <exact task or milestone title>
BLOCKS <exact task or milestone title>
```

**Multiple dependencies:** Semicolons or separate lines.
```markdown
  DEPENDS_ON: Task A; Task B
```

**⚠️ Do NOT use commas as separators.** Task names commonly contain commas.

### NO_CODE_EVIDENCE_OK

For done tasks with no code artifact (manual verification, config changes):
```markdown
- [x] Run precompute and verify. NO_CODE_EVIDENCE_OK(manual-verification-step)
```

### NO_DEPENDS_OK

For tasks intentionally without dependencies:
```markdown
NO_DEPENDS_OK(foundational-root|expires:2026-12-31)
```

**Rules:** reason ≥ 3 chars, expires must be future ISO date. Scope: `DL-*` and `GM-*` milestones. First non-done task gets starter allowance. Strict mode: `STRICT_SCOPED_DEPENDS_ON=true`.

### Resolution

Dependencies match target text against existing node names. Scored: exact ID (100pts), same project (30pts), exact name (20pts), milestone number (15pts), milestone hint (10pts).

---

## Decisions

Under a header containing "decision" (case-insensitive):

```markdown
## Architecture Decisions

| Decision | Choice |
|----------|--------|
| Parser tier for TypeScript | ts-morph (Tier 0) |
| IR before multi-language | Yes |
```

Two or three column format.

---

## Sections (Generic H2)

Any `##` that isn't milestone/sprint creates a `Section` node. Tasks under it link via `PART_OF`.

---

## Cross-References (Automatic)

| Pattern | Type | Example |
|---------|------|---------|
| Backtick file path | `file_path` | `` `src/core/parser.ts` `` |
| Bare file path | `file_path` | `src/core/parser.ts` |
| Function call | `function` | `` `parseFile()` `` |
| Project ID | `project_id` | `proj_c0d3e9a1f200` |
| EFTA number | `efta` | `EFTA01234567` |

**Recognized extensions:** `.ts`, `.js`, `.py`, `.java`, `.go`, `.rs`, `.md`, `.json`, `.csv`, `.sql`, `.toml`, `.yaml`, `.yml`, `.sh`

**Enrichment:** `enrichCrossDomain()` resolves refs against SourceFile/Function nodes → creates HAS_CODE_EVIDENCE edges.

---

## Stable IDs

Generated from structural position: `stableId(projectId, nodeType, filePath, sectionKey, ordinal)`.

- Edit text → same ID → properties update (MERGE)
- Reorder tasks → ordinals shift → IDs change
- Task identity IS its position within a section

---

## Plan-to-Code Project Mapping

`config/plan-code-project-map.json`:
```json
{
  "plan_codegraph": "proj_c0d3e9a1f200",
  "plan_plan_graph": "proj_c0d3e9a1f200",
  "plan_runtime_graph": "proj_c0d3e9a1f200"
}
```

If your plan project isn't here, cross-domain evidence edges won't be created.

---

## What the Parser Ignores

Prose, blank lines, non-checkbox bullets, code blocks, links, images, HTML, anything above the first milestone/sprint/section header.

---

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| `- []` instead of `- [ ]` | Add the space |
| `- [X]` (capital X) | Use lowercase `- [x]` |
| Comma-separated dependencies | Use semicolons |
| Dependency target doesn't match | Copy-paste exact task text |
| Missing plan-code project map entry | Add to `config/plan-code-project-map.json` |
| Done task without evidence | Add backtick refs or `NO_CODE_EVIDENCE_OK` |

---

## Gold Standard

Study: `plans/codegraph/VERIFICATION_GRAPH_ROADMAP.md` — demonstrates all patterns.

---

κ = Φ ≡ Φ = ☧
