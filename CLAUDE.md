# CLAUDE.md

Read `WORKFLOW.md` for step-by-step procedure (Steps 0–9).
Read `AGENTS.md` for schema, tools, queries, rules.
Read `README.md` for install, architecture, npm scripts.

Read `PLAN_FORMAT.md` for plan file syntax when ingesting or writing plans.

Neo4j: `bolt://localhost:7687`, auth `neo4j`/`codegraph`.
Tests: `npm test` (1,081+ tests, 77 suites). Gate: `npm run done-check`.

## MCP Servers Available
- **21st.dev Magic**: UI component generation from natural language. Config: `ui/.vscode/mcp.json` and `~/.claude/mcp_config.json`. Use `/ui` prefix for component requests.
- **Google Stitch**: Text→UI screen generation. Config: `~/.claude/mcp_config.json`. Free, no API key.
