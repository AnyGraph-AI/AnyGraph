/**
 * Detect Hotspots Tool
 * Identifies code hotspots: files/functions that change frequently AND have high structural risk.
 * Inspired by CodeScene's hotspot analysis — combining change frequency with structural risk.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { toNumber } from '../../core/utils/shared-utils.js';
import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import { createErrorResponse, createSuccessResponse, debugLog, resolveProjectIdOrError } from '../utils.js';

export function createDetectHotspotsTool(server: McpServer) {
  const neo4jService = new Neo4jService();
  
  server.tool(
    'detect_hotspots',
    'Identify code hotspots — functions and files that change frequently AND have high structural risk. ' +
    'High-frequency + high-complexity = refactoring priority. Returns ranked lists with hotspot scores.',
    {
      projectId: z.string().describe('Project ID to analyze'),
      level: z.enum(['function', 'file', 'both']).optional().describe('Analyze at function level, file level, or both (default: both)'),
      limit: z.number().optional().describe('Max results per level (default: 20)'),
      minRiskLevel: z.number().optional().describe('Minimum riskLevel to include (default: 0)'),
      minChangeFrequency: z.number().optional().describe('Minimum gitChangeFrequency 0.0-1.0 (default: 0)'),
    },
    async (args) => {
      try {
        const resolved = await resolveProjectIdOrError(args.projectId, neo4jService);
        if (!resolved.success) return resolved.error!;
        const projectId = resolved.projectId!;
        
        const level = args.level || 'both';
        const limit = args.limit || 20;
        const minRisk = args.minRiskLevel || 0;
        const minGcf = args.minChangeFrequency || 0;
        const results: string[] = [];
        
        // Function-level hotspots
        if (level === 'function' || level === 'both') {
          const rows = await neo4jService.run(`
            MATCH (f:CodeNode {projectId: $projectId})
            WHERE f.riskLevel IS NOT NULL 
            AND f.riskLevel >= $minRisk
            OPTIONAL MATCH (f)-[:TESTED_BY]->(tc:TestCase)
            WITH f, count(tc) > 0 AS hasCoverage
            WITH f, hasCoverage,
              coalesce(f.gitChangeFrequency, 0.0) AS gcf,
              f.riskLevel AS risk,
              coalesce(f.fanInCount, 0) AS fanIn,
              coalesce(f.fanOutCount, 0) AS fanOut,
              coalesce(f.lineCount, 0) AS lc,
              coalesce(f.authorEntropy, 1) AS ae,
              coalesce(f.temporalCoupling, 0) AS tc
            WHERE gcf >= $minGcf
            WITH f, hasCoverage, gcf, risk, fanIn, fanOut, lc, ae, tc,
              risk * (1.0 + gcf * 2.0) * (1.0 + ae * 0.2) AS hotspotScore
            RETURN f.name AS name, f.filePath AS filePath,
              risk AS riskLevel, f.riskTier AS riskTier,
              gcf AS gitChangeFrequency,
              fanIn, fanOut, lc AS lineCount,
              hotspotScore,
              ae AS authorEntropy, tc AS temporalCoupling,
              hasCoverage AS testCoverage
            ORDER BY hotspotScore DESC
            LIMIT toInteger($limit)
          `, { projectId, minRisk, minGcf, limit });
          
          if (rows.length > 0) {
            results.push('## Function Hotspots\n');
            results.push('| # | Function | File | Risk | Tier | ChgFreq | FanIn/Out | Lines | Hotspot | Tests |');
            results.push('|---|----------|------|------|------|---------|-----------|-------|---------|-------|');
            
            rows.forEach((r: any, i: number) => {
              const name = r.name;
              const file = (r.filePath || '').split('/').slice(-2).join('/');
              const risk = (toNumber(r.riskLevel) || 0).toFixed(1);
              const tier = r.riskTier || 'N/A';
              const gcf = (toNumber(r.gitChangeFrequency) || 0).toFixed(3);
              const fi = toNumber(r.fanIn) || 0;
              const fo = toNumber(r.fanOut) || 0;
              const lines = toNumber(r.lineCount) || 0;
              const score = (toNumber(r.hotspotScore) || 0).toFixed(1);
              const tested = r.testCoverage ? '✅' : '❌';
              results.push(`| ${i+1} | ${name} | ${file} | ${risk} | ${tier} | ${gcf} | ${fi}/${fo} | ${lines} | ${score} | ${tested} |`);
            });
            
            const untestedCount = rows.filter((r: any) => !r.testCoverage).length;
            if (untestedCount > 0) {
              results.push(`\n⚠️ **${untestedCount}/${rows.length} hotspots have NO test coverage.**`);
            }
          } else {
            results.push('No function hotspots found matching criteria.');
          }
        }
        
        // File-level hotspots
        if (level === 'file' || level === 'both') {
          const rows = await neo4jService.run(`
            MATCH (sf:CodeNode {projectId: $projectId})
            WHERE sf.filePath IS NOT NULL
            AND (sf:SourceFile OR sf.type = 'SourceFile')
            OPTIONAL MATCH (sf)-[:CONTAINS]->(f)
            WHERE f.riskLevel IS NOT NULL
            WITH sf, 
              count(f) AS funcCount,
              avg(f.riskLevel) AS avgRisk,
              max(f.riskLevel) AS maxRisk,
              coalesce(sf.gitChangeFrequency, 0.0) AS gcf,
              coalesce(sf.dependentCount, 0) AS deps
            WHERE gcf >= $minGcf
            OPTIONAL MATCH (sf)-[:OWNED_BY]->(a:Author)
            WITH sf, funcCount, avgRisk, maxRisk, gcf, deps, count(a) AS authorCount,
              (coalesce(avgRisk, 0) * funcCount) * (1.0 + gcf * 2.0) * (1.0 + deps * 0.1) AS hotspotScore
            WHERE hotspotScore > 0
            RETURN sf.filePath AS filePath, funcCount, deps AS dependentCount,
              gcf AS gitChangeFrequency,
              avgRisk AS avgRiskLevel,
              maxRisk AS maxRiskLevel,
              hotspotScore,
              authorCount
            ORDER BY hotspotScore DESC
            LIMIT toInteger($limit)
          `, { projectId, minGcf, limit });
          
          if (rows.length > 0) {
            if (results.length > 0) results.push('\n');
            results.push('## File Hotspots\n');
            results.push('| # | File | Funcs | Deps | ChgFreq | AvgRisk | MaxRisk | Authors | Hotspot |');
            results.push('|---|------|-------|------|---------|---------|---------|---------|---------|');
            
            rows.forEach((r: any, i: number) => {
              const file = (r.filePath || '').split('/').slice(-2).join('/');
              const funcs = toNumber(r.funcCount) || 0;
              const deps = toNumber(r.dependentCount) || 0;
              const gcf = (toNumber(r.gitChangeFrequency) || 0).toFixed(3);
              const avgRisk = (toNumber(r.avgRiskLevel) || 0).toFixed(1);
              const maxRisk = (toNumber(r.maxRiskLevel) || 0).toFixed(1);
              const authors = toNumber(r.authorCount) || 0;
              const score = (toNumber(r.hotspotScore) || 0).toFixed(1);
              results.push(`| ${i+1} | ${file} | ${funcs} | ${deps} | ${gcf} | ${avgRisk} | ${maxRisk} | ${authors} | ${score} |`);
            });
          } else {
            results.push('No file hotspots found matching criteria.');
          }
        }
        
        return createSuccessResponse(results.join('\n'));
      } catch (error: any) {
        debugLog('detect_hotspots error:', error);
        return createErrorResponse(`Hotspot detection failed: ${error.message}`);
      }
    }
  );
}
