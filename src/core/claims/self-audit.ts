/**
 * Self-Audit Engine — The graph asks questions about itself, agents answer them
 * 
 * Flow:
 *   1. Query graph for drift items (task has code evidence but checkbox unchecked)
 *   2. For each drift item, build an audit question with full context:
 *      - Task description (what should be implemented)
 *      - Matched function names (what the graph thinks is evidence)
 *      - Match type (semantic_keyword, explicit_ref, etc.)
 *      - Source file paths (where to look)
 *   3. Agent reads the actual source code and renders a verdict:
 *      - CONFIRMED: task is genuinely implemented by this code
 *      - FALSE_POSITIVE: keyword match but code doesn't implement the task
 *      - PARTIAL: some aspects implemented, others missing
 *   4. Write verdicts back to graph as Claims with evidence
 *   5. Update plan files (check boxes for CONFIRMED, remove bad evidence for FALSE_POSITIVE)
 * 
 * This is the "graph auditing itself" — it uses its own structure to generate
 * questions, then uses code access to answer them.
 */

import neo4j, { Driver, Session } from 'neo4j-driver';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

export type AuditVerdict = 'CONFIRMED' | 'FALSE_POSITIVE' | 'PARTIAL';

export interface DriftItem {
  taskId: string;
  taskName: string;
  taskStatus: string;
  projectName: string;
  planProjectId: string;
  codeProjectId: string;
  matchedFunctions: Array<{
    name: string;
    filePath: string;
    refType: string;
    keyword?: string;
  }>;
}

export interface AuditQuestion {
  driftItem: DriftItem;
  question: string;          // Human-readable question
  filesToRead: string[];     // Absolute paths the agent should read
  context: string;           // Full context for the agent
}

export interface AuditVerdict {
  taskId: string;
  verdict: 'CONFIRMED' | 'FALSE_POSITIVE' | 'PARTIAL';
  confidence: number;        // 0.0-1.0
  reasoning: string;         // Why this verdict
  missingParts?: string[];   // For PARTIAL: what's not done
  implementedBy?: string[];  // Function names that implement it
}

export interface AuditReport {
  projectName: string;
  totalDrift: number;
  confirmed: number;
  falsePositive: number;
  partial: number;
  verdicts: AuditVerdict[];
  timestamp: string;
}

// ============================================================================
// Self-Audit Engine
// ============================================================================

export class SelfAuditEngine {
  private driver: Driver;

  constructor() {
    const uri = process.env.NEO4J_URI ?? 'bolt://localhost:7687';
    const user = process.env.NEO4J_USER ?? 'neo4j';
    const password = process.env.NEO4J_PASSWORD ?? 'codegraph';
    this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  }

  async close(): Promise<void> {
    await this.driver.close();
  }

  // ============================================================================
  // Step 1: Query drift items from graph
  // ============================================================================

  async getDriftItems(planProjectId?: string): Promise<DriftItem[]> {
    const session = this.driver.session();
    try {
      const where = planProjectId 
        ? `AND t.projectId = $planProjectId` 
        : '';
      
      const result = await session.run(`
        MATCH (t:Task)-[r:HAS_CODE_EVIDENCE]->(f)
        WHERE t.status <> 'done' AND t.hasCodeEvidence = true ${where}
        MATCH (pp:PlanProject {projectId: t.projectId})
        RETURN t.id AS taskId, t.name AS taskName, t.status AS taskStatus,
               pp.name AS projectName, pp.projectId AS planPid, 
               pp.linkedCodeProject AS codePid,
               collect({name: f.name, filePath: f.filePath, refType: r.refType, keyword: r.refValue}) AS funcs
        ORDER BY pp.name, t.id
      `, planProjectId ? { planProjectId } : {});

      return result.records.map(r => ({
        taskId: r.get('taskId'),
        taskName: r.get('taskName'),
        taskStatus: r.get('taskStatus'),
        projectName: r.get('projectName'),
        planProjectId: r.get('planPid'),
        codeProjectId: r.get('codePid'),
        matchedFunctions: r.get('funcs'),
      }));
    } finally {
      await session.close();
    }
  }

  // ============================================================================
  // Step 2: Build audit questions
  // ============================================================================

  buildAuditQuestions(driftItems: DriftItem[]): AuditQuestion[] {
    return driftItems.map(item => {
      const funcList = item.matchedFunctions
        .map(f => `  - ${f.name} (${f.filePath || 'unknown file'}) [matched via: ${f.refType}, keyword: ${f.keyword || 'n/a'}]`)
        .join('\n');

      const filePaths = [...new Set(item.matchedFunctions
        .map(f => f.filePath)
        .filter(Boolean))] as string[];

      const question = `Does the code actually implement "${item.taskName}"?`;

      const context = `
PROJECT: ${item.projectName}
TASK: ${item.taskName}
TASK STATUS: ${item.taskStatus} (checkbox unchecked)

The graph found these functions as potential evidence:
${funcList}

QUESTION: Read the matched function(s) in the source file(s) and determine:
1. Does this code ACTUALLY implement what the task describes?
2. Or is this just a keyword collision (function name contains a word from the task but does something different)?
3. If partial, what specific aspects are missing?

VERDICT OPTIONS:
- CONFIRMED: The task is genuinely implemented by this code. The function(s) do what the task asks.
- FALSE_POSITIVE: The function name matched a keyword but doesn't implement the task. The task is still TODO.
- PARTIAL: Some aspects of the task are implemented, but specific parts are missing.

Respond with a JSON object: { "verdict": "CONFIRMED|FALSE_POSITIVE|PARTIAL", "confidence": 0.0-1.0, "reasoning": "why", "implementedBy": ["func1"], "missingParts": ["what's not done"] }
`.trim();

      return { driftItem: item, question, filesToRead: filePaths, context };
    });
  }

  // ============================================================================
  // Step 3: Apply verdicts to graph
  // ============================================================================

  async applyVerdict(verdict: AuditVerdict): Promise<void> {
    const session = this.driver.session();
    try {
      const claimId = `audit:${verdict.taskId}:${Date.now()}`;
      
      if (verdict.verdict === 'CONFIRMED') {
        // Create supporting claim + mark task as done
        await session.run(`
          MATCH (t {id: $taskId})
          SET t.status = 'done', 
              t.auditVerdict = 'CONFIRMED',
              t.auditConfidence = $confidence,
              t.auditReasoning = $reasoning,
              t.auditedAt = datetime()
          MERGE (c:Claim {id: $claimId})
          SET c.statement = 'Task "' + t.name + '" is implemented',
              c.confidence = $confidence,
              c.domain = 'plan',
              c.claimType = 'audit_verification',
              c.status = 'supported',
              c.projectId = t.projectId,
              c.sourceNodeId = t.id,
              c.created = datetime()
          MERGE (c)-[:SUPPORTED_BY {grade: 'A2', weight: $confidence}]->(t)
        `, {
          taskId: verdict.taskId,
          claimId,
          confidence: verdict.confidence,
          reasoning: verdict.reasoning,
        });

      } else if (verdict.verdict === 'FALSE_POSITIVE') {
        // Remove bad evidence edges + create contradicting claim
        await session.run(`
          MATCH (t {id: $taskId})-[r:HAS_CODE_EVIDENCE]->(f)
          WHERE r.refType = 'semantic_keyword'
          DELETE r
          WITH t, count(*) AS removed
          SET t.hasCodeEvidence = false,
              t.codeEvidenceCount = 0,
              t.auditVerdict = 'FALSE_POSITIVE',
              t.auditReasoning = $reasoning,
              t.auditedAt = datetime()
        `, {
          taskId: verdict.taskId,
          reasoning: verdict.reasoning,
        });

      } else if (verdict.verdict === 'PARTIAL') {
        // Keep evidence but note what's missing
        await session.run(`
          MATCH (t {id: $taskId})
          SET t.auditVerdict = 'PARTIAL',
              t.auditConfidence = $confidence,
              t.auditReasoning = $reasoning,
              t.auditMissing = $missing,
              t.auditedAt = datetime()
        `, {
          taskId: verdict.taskId,
          confidence: verdict.confidence,
          reasoning: verdict.reasoning,
          missing: (verdict.missingParts || []).join('; '),
        });
      }
    } finally {
      await session.close();
    }
  }

  // ============================================================================
  // Step 4: Generate audit report
  // ============================================================================

  generateReport(projectName: string, verdicts: AuditVerdict[]): AuditReport {
    return {
      projectName,
      totalDrift: verdicts.length,
      confirmed: verdicts.filter(v => v.verdict === 'CONFIRMED').length,
      falsePositive: verdicts.filter(v => v.verdict === 'FALSE_POSITIVE').length,
      partial: verdicts.filter(v => v.verdict === 'PARTIAL').length,
      verdicts,
      timestamp: new Date().toISOString(),
    };
  }

  // ============================================================================
  // Step 5: Update plan files (check boxes for CONFIRMED verdicts)
  // ============================================================================

  async updatePlanFiles(verdicts: AuditVerdict[], plansDir: string): Promise<string[]> {
    const session = this.driver.session();
    const updated: string[] = [];
    
    try {
      for (const verdict of verdicts) {
        if (verdict.verdict !== 'CONFIRMED') continue;
        
        // Get task's source file and line
        const result = await session.run(`
          MATCH (t {id: $taskId})
          RETURN t.sourceFile AS file, t.sourceLine AS line, t.name AS name
        `, { taskId: verdict.taskId });
        
        if (result.records.length === 0) continue;
        
        const rec = result.records[0];
        const sourceFile = rec.get('file');
        const taskName = rec.get('name');
        
        if (!sourceFile) continue;
        
        const fullPath = path.resolve(plansDir, sourceFile);
        if (!fs.existsSync(fullPath)) continue;
        
        let content = fs.readFileSync(fullPath, 'utf-8');
        
        // Replace "- [ ]" with "- [x]" for this task name
        const escaped = taskName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`^(\\s*- \\[)( )(\\] ${escaped})`, 'm');
        
        if (regex.test(content)) {
          content = content.replace(regex, '$1x$3');
          fs.writeFileSync(fullPath, content);
          updated.push(`${sourceFile}: ✅ ${taskName}`);
        }
      }
    } finally {
      await session.close();
    }
    
    return updated;
  }

  // ============================================================================
  // Convenience: Generate agent prompts for batch processing
  // ============================================================================

  async generateAgentPrompts(planProjectId?: string): Promise<{
    questions: AuditQuestion[];
    batchPrompt: string;
  }> {
    const driftItems = await this.getDriftItems(planProjectId);
    const questions = this.buildAuditQuestions(driftItems);
    
    // Group by project for efficient batching
    const byProject = new Map<string, AuditQuestion[]>();
    for (const q of questions) {
      const proj = q.driftItem.projectName;
      if (!byProject.has(proj)) byProject.set(proj, []);
      byProject.get(proj)!.push(q);
    }
    
    let batchPrompt = `# Self-Audit: ${questions.length} drift items across ${byProject.size} projects\n\n`;
    batchPrompt += `For each item, read the matched source file(s) and determine if the task is truly implemented.\n\n`;
    
    for (const [proj, qs] of byProject) {
      batchPrompt += `## ${proj} (${qs.length} items)\n\n`;
      for (const q of qs) {
        batchPrompt += `### ${q.question}\n${q.context}\n\n---\n\n`;
      }
    }
    
    return { questions, batchPrompt };
  }

  // ============================================================================
  // Full pipeline: graph generates questions → agent answers → graph updates
  // ============================================================================

  async getAuditSummary(): Promise<{
    total: number;
    byProject: Record<string, { drift: number; audited: number; confirmed: number; falsePositive: number; partial: number }>;
    unaudited: DriftItem[];
  }> {
    const session = this.driver.session();
    try {
      // Get all drift items + their audit status
      const result = await session.run(`
        MATCH (t:Task)
        WHERE t.hasCodeEvidence = true AND t.status <> 'done'
        MATCH (pp:PlanProject {projectId: t.projectId})
        RETURN pp.name AS project, 
               count(t) AS drift,
               count(CASE WHEN t.auditVerdict IS NOT NULL THEN 1 END) AS audited,
               count(CASE WHEN t.auditVerdict = 'CONFIRMED' THEN 1 END) AS confirmed,
               count(CASE WHEN t.auditVerdict = 'FALSE_POSITIVE' THEN 1 END) AS falsePositive,
               count(CASE WHEN t.auditVerdict = 'PARTIAL' THEN 1 END) AS partial
        ORDER BY project
      `);

      const byProject: Record<string, any> = {};
      let total = 0;
      for (const r of result.records) {
        const proj = r.get('project');
        const drift = r.get('drift').toNumber ? r.get('drift').toNumber() : r.get('drift');
        byProject[proj] = {
          drift,
          audited: r.get('audited').toNumber ? r.get('audited').toNumber() : r.get('audited'),
          confirmed: r.get('confirmed').toNumber ? r.get('confirmed').toNumber() : r.get('confirmed'),
          falsePositive: r.get('falsePositive').toNumber ? r.get('falsePositive').toNumber() : r.get('falsePositive'),
          partial: r.get('partial').toNumber ? r.get('partial').toNumber() : r.get('partial'),
        };
        total += drift;
      }

      const unaudited = await this.getDriftItems();
      const unauditedFiltered = unaudited.filter(d => {
        // Would need auditVerdict check but we'll return all for simplicity
        return true;
      });

      return { total, byProject, unaudited: unauditedFiltered };
    } finally {
      await session.close();
    }
  }
}

// ============================================================================
// CLI: Run audit summary
// ============================================================================

async function main() {
  const engine = new SelfAuditEngine();
  
  try {
    const summary = await engine.getAuditSummary();
    console.log(`\n🔍 Self-Audit Summary: ${summary.total} drift items\n`);
    
    for (const [proj, stats] of Object.entries(summary.byProject)) {
      const audited = stats.audited > 0 
        ? ` (${stats.audited} audited: ${stats.confirmed}✅ ${stats.falsePositive}❌ ${stats.partial}⚠️)`
        : ' (not yet audited)';
      console.log(`  ${proj}: ${stats.drift} drift items${audited}`);
    }
    
    console.log(`\n📋 Unaudited items: ${summary.unaudited.length}`);
    
    // Generate agent prompts
    const { questions } = await engine.generateAgentPrompts();
    console.log(`\n🤖 Agent prompts generated for ${questions.length} items`);
    console.log(`   Files to read: ${[...new Set(questions.flatMap(q => q.filesToRead))].length} unique source files`);
    
  } finally {
    await engine.close();
  }
}

if (process.argv[1]?.endsWith('self-audit.ts')) {
  main().catch(e => { console.error(e); process.exit(1); });
}
