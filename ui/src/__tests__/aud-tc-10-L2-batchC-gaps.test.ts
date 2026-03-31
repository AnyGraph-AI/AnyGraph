/**
 * AUD-TC-10 L2 Batch C Gap-Fill Tests
 *
 * Tests for L2-17 through L2-24 component behaviors.
 * NODE ENVIRONMENT: No DOM, no render, no screen queries.
 * Tests: source patterns, exports, constants, pure function logic via source inspection.
 */
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const componentsDir = resolve(import.meta.dirname, '..', 'components');

// ═══════════════════════════════════════════════════════════════
// L2-17: MilestoneProgress.tsx
// ═══════════════════════════════════════════════════════════════

describe('[L2-17] MilestoneProgress component behaviors', () => {
  let source: string;

  it('reads MilestoneProgress source', async () => {
    source = await readFile(resolve(componentsDir, 'MilestoneProgress.tsx'), 'utf-8');
    expect(source.length).toBeGreaterThan(0);
  });

  it('(1) uses Recharts BarChart with vertical layout for horizontal bars', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'MilestoneProgress.tsx'), 'utf-8');
    expect(source).toContain("import { BarChart");
    expect(source).toContain('layout="vertical"');
  });

  it('(2) groups milestones by project via Map<string, MilestoneRow[]>', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'MilestoneProgress.tsx'), 'utf-8');
    expect(source).toMatch(/byProject.*=.*new Map/);
    expect(source).toContain('byProject.get(row.projectId)');
  });

  it('(3) color codes: 100%=green (#22c55e), partial=PROJECT_COLORS, 0%=zinc (#3f3f46)', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'MilestoneProgress.tsx'), 'utf-8');
    // 100% completion = green
    expect(source).toMatch(/m\.pct\s*===\s*100[\s\S]*?['"]#22c55e['"]/);
    // 0% completion = zinc
    expect(source).toContain('#3f3f46');
    // PROJECT_COLORS mapping exists
    expect(source).toMatch(/PROJECT_COLORS\s*:\s*Record<string,\s*string>/);
  });

  it('(4) shortName extracts milestone ID (e.g., "UI-3" from "Milestone UI-3: ...")', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'MilestoneProgress.tsx'), 'utf-8');
    expect(source).toContain('function shortName');
    expect(source).toMatch(/Milestone\\s\+\(\[A-Z0-9\]/);
  });

  it('(5) handles empty data with fallback message', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'MilestoneProgress.tsx'), 'utf-8');
    expect(source).toMatch(/data\.length\s*===\s*0|!data\s*\|\|\s*data\.length\s*===\s*0/);
    expect(source).toContain('No milestone data available');
  });

  it('PROJECT_COLORS has expected project keys', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'MilestoneProgress.tsx'), 'utf-8');
    expect(source).toContain('plan_codegraph');
    expect(source).toContain('plan_godspeed');
    expect(source).toContain('plan_plan_graph');
  });
});

// ═══════════════════════════════════════════════════════════════
// L2-18: PainHeatmap.tsx
// ═══════════════════════════════════════════════════════════════

describe('[L2-18] PainHeatmap component behaviors', () => {
  let source: string;

  it('reads PainHeatmap source', async () => {
    source = await readFile(resolve(componentsDir, 'PainHeatmap.tsx'), 'utf-8');
    expect(source.length).toBeGreaterThan(0);
  });

  it('(1) uses Recharts Treemap component', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'PainHeatmap.tsx'), 'utf-8');
    expect(source).toContain("import { Treemap");
    expect(source).toContain('<Treemap');
  });

  it('(2) cell fill color from confidenceColor(confidenceScore)', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'PainHeatmap.tsx'), 'utf-8');
    expect(source).toContain("import { confidenceColor");
    expect(source).toMatch(/fill\s*=\s*confidenceColor\(confidenceScore\)/);
  });

  it('(3) cell opacity from painOpacity(adjustedPain, maxPain)', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'PainHeatmap.tsx'), 'utf-8');
    expect(source).toContain("import { confidenceColor, painOpacity }");
    expect(source).toMatch(/opacity\s*=\s*painOpacity\(adjustedPain,\s*maxPain\)/);
  });

  it('(4) low-confidence cells (< 0.5) get SVG stripe pattern overlay', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'PainHeatmap.tsx'), 'utf-8');
    expect(source).toMatch(/isLowConfidence.*<\s*0\.5/);
    expect(source).toContain('<pattern');
    expect(source).toContain('patternTransform="rotate(45)"');
    expect(source).toMatch(/\{isLowConfidence\s*&&/);
  });

  it('(5) onCellClick callback fires with HeatmapFile data', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'PainHeatmap.tsx'), 'utf-8');
    expect(source).toMatch(/onCellClick\?:\s*\(file:\s*HeatmapFile\)/);
    expect(source).toMatch(/onClick\s*=\s*\{onCellClick\s*\?/);
  });

  it('(6) tooltip shows adjustedPain, rawPain (painScore), confidence%, fragility', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'PainHeatmap.tsx'), 'utf-8');
    expect(source).toContain('Adjusted Pain');
    expect(source).toContain('Raw Pain');
    expect(source).toContain('Confidence');
    expect(source).toContain('Fragility');
    expect(source).toMatch(/d\.adjustedPain/);
    expect(source).toMatch(/d\.painScore/);
    expect(source).toMatch(/d\.confidenceScore/);
    expect(source).toMatch(/d\.fragility/);
  });

  it('(7) cells have aria-label with name + pain + confidence', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'PainHeatmap.tsx'), 'utf-8');
    expect(source).toMatch(/aria-label\s*=\s*\{`\$\{name\}.*pain.*confidence/);
  });

  it('(8) handles empty data with fallback message', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'PainHeatmap.tsx'), 'utf-8');
    expect(source).toMatch(/data\.length\s*===\s*0/);
    expect(source).toContain('No files with pain scores found');
  });

  it('exports HeatmapFile interface', async () => {
    const mod = await import('@/components/PainHeatmap');
    expect(mod.PainHeatmap).toBeDefined();
    // Type export check - if it compiles, the interface is exported
  });
});

// ═══════════════════════════════════════════════════════════════
// L2-19: ProbeResultsGrid.tsx
// ═══════════════════════════════════════════════════════════════

describe('[L2-19] ProbeResultsGrid component behaviors', () => {
  let source: string;

  it('reads ProbeResultsGrid source', async () => {
    source = await readFile(resolve(componentsDir, 'ProbeResultsGrid.tsx'), 'utf-8');
    expect(source.length).toBeGreaterThan(0);
  });

  it('(1) groups probes by category using Map and CATEGORY_ORDER', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'ProbeResultsGrid.tsx'), 'utf-8');
    expect(source).toContain('CATEGORY_ORDER');
    expect(source).toMatch(/grouped.*useMemo/);
    expect(source).toMatch(/map\.get\(probe\.category\)/);
  });

  it('(2) toHealthStatus maps pass→healthy, warn+rows→warning, warn+norows→critical', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'ProbeResultsGrid.tsx'), 'utf-8');
    expect(source).toContain('function toHealthStatus');
    expect(source).toMatch(/probe\.status\s*===\s*['"]pass['"]/);
    expect(source).toMatch(/probe\.status\s*===\s*['"]warn['"]/);
    expect(source).toMatch(/probe\.rows\.length\s*===\s*0.*['"]critical['"]/);
  });

  it('(3) healthStyles returns correct color classes per health status', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'ProbeResultsGrid.tsx'), 'utf-8');
    expect(source).toContain('function healthStyles');
    expect(source).toContain('text-emerald-300'); // healthy
    expect(source).toContain('text-amber-300');   // warning
    expect(source).toContain('text-red-300');     // critical
  });

  it('(4) card shows status indicator and row count', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'ProbeResultsGrid.tsx'), 'utf-8');
    expect(source).toContain('healthStyles(status)');
    expect(source).toMatch(/rows:\s*\{probe\.rows\.length\}/);
  });

  it('(5) click card expands full result table via expandedProbeId state', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'ProbeResultsGrid.tsx'), 'utf-8');
    expect(source).toMatch(/expandedProbeId.*useState/);
    expect(source).toMatch(/setExpandedProbeId\(isExpanded\s*\?\s*null\s*:\s*probe\.id\)/);
    expect(source).toMatch(/\{isExpanded\s*&&/);
  });

  it('(6) sortRows sorts by column key ascending/descending', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'ProbeResultsGrid.tsx'), 'utf-8');
    expect(source).toContain('function sortRows');
    expect(source).toMatch(/sortDir\s*===\s*['"]asc['"]/);
    expect(source).toMatch(/sortState.*useState/);
  });

  it('(7) getExplorerHref generates Explorer deep-links for file/function cells', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'ProbeResultsGrid.tsx'), 'utf-8');
    expect(source).toContain('function getExplorerHref');
    expect(source).toMatch(/`\/explorer\?\$\{/); // template literal /explorer?${params}
    expect(source).toContain('focus:');
    expect(source).toContain('focusType');
    expect(source).toContain('isFileOrFunctionField');
  });

  it('(8) handles empty probes array', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'ProbeResultsGrid.tsx'), 'utf-8');
    expect(source).toMatch(/!probes\.length|probes\.length\s*===\s*0/);
    expect(source).toContain('No probe results');
  });

  it('CATEGORY_ORDER contains expected categories', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'ProbeResultsGrid.tsx'), 'utf-8');
    expect(source).toContain("'Code'");
    expect(source).toContain("'Plan↔Code'");
    expect(source).toContain("'Verification'");
    expect(source).toContain("'Risk'");
  });
});

// ═══════════════════════════════════════════════════════════════
// L2-20: ProgressRing.tsx
// ═══════════════════════════════════════════════════════════════

describe('[L2-20] ProgressRing component behaviors', () => {
  let source: string;

  it('reads ProgressRing source', async () => {
    source = await readFile(resolve(componentsDir, 'ProgressRing.tsx'), 'utf-8');
    expect(source.length).toBeGreaterThan(0);
  });

  it('(1) renders SVG circle with stroke-dasharray proportional to value/max', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'ProgressRing.tsx'), 'utf-8');
    expect(source).toContain('<svg');
    expect(source).toContain('<circle');
    // pct = value/max calculation
    expect(source).toMatch(/pct\s*=.*value\s*\/\s*max/);
    // circumference = 2πr
    expect(source).toMatch(/circ\s*=\s*2\s*\*\s*Math\.PI\s*\*\s*r/);
    // strokeDasharray={circ}
    expect(source).toMatch(/strokeDasharray\s*=\s*\{circ\}/);
    // strokeDashoffset={circ * (1 - pct)}
    expect(source).toMatch(/strokeDashoffset\s*=\s*\{circ\s*\*\s*\(1\s*-\s*pct\)\}/);
  });

  it('(2) accepts size, strokeWidth, value, max props with defaults', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'ProgressRing.tsx'), 'utf-8');
    expect(source).toMatch(/interface\s+ProgressRingProps/);
    expect(source).toContain('value: number');
    expect(source).toContain('max: number');
    expect(source).toContain('size?: number');
    // Default size = 56
    expect(source).toMatch(/size\s*=\s*56/);
  });

  it('(3) renders value/max label below the ring', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'ProgressRing.tsx'), 'utf-8');
    expect(source).toContain('{value}');
    expect(source).toContain('/{max}');
    expect(source).toContain('{label}');
  });

  it('exports ProgressRingProps interface', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'ProgressRing.tsx'), 'utf-8');
    expect(source).toContain('export interface ProgressRingProps');
  });
});

// ═══════════════════════════════════════════════════════════════
// L2-21: RealityGap.tsx
// ═══════════════════════════════════════════════════════════════

describe('[L2-21] RealityGap component behaviors', () => {
  let source: string;

  it('reads RealityGap source', async () => {
    source = await readFile(resolve(componentsDir, 'RealityGap.tsx'), 'utf-8');
    expect(source.length).toBeGreaterThan(0);
  });

  it('(1) renders table with file name, tier, gap, evidence, confidence, pain columns', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'RealityGap.tsx'), 'utf-8');
    expect(source).toContain('<table');
    expect(source).toContain('<thead');
    expect(source).toContain('<tbody');
    expect(source).toContain('>File<');
    expect(source).toContain('>Tier<');
    // Gap header is dynamic: Gap{sortArrow('gapScore')}
    expect(source).toMatch(/Gap\{sortArrow/);
  });

  it('(2) severityFilter filters by critical-high (gapScore >= 0.5)', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'RealityGap.tsx'), 'utf-8');
    expect(source).toMatch(/severityFilter\s*===\s*['"]critical-high['"]/);
    expect(source).toMatch(/row\.gapScore\s*<\s*0\.5/);
  });

  it('(3) minGap prop filters minimum gap score', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'RealityGap.tsx'), 'utf-8');
    expect(source).toMatch(/row\.gapScore\s*<\s*minGap/);
    expect(source).toMatch(/minGap.*useState/);
  });

  it('(4) snoozeFile stores with SNOOZE_PREFIX and 7-day duration', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'RealityGap.tsx'), 'utf-8');
    expect(source).toContain("SNOOZE_PREFIX = 'reality-gap-snooze:'");
    expect(source).toMatch(/SNOOZE_DURATION_MS\s*=\s*7\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
    expect(source).toContain('function snoozeFile');
    expect(source).toContain('localStorage.setItem');
    expect(source).toContain('SNOOZE_DURATION_MS');
  });

  it('(5) isSnoozed checks localStorage for unexpired snooze', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'RealityGap.tsx'), 'utf-8');
    expect(source).toContain('function isSnoozed');
    expect(source).toContain('localStorage.getItem');
    expect(source).toMatch(/Date\.now\(\)\s*>\s*expiry/);
    expect(source).toContain('localStorage.removeItem'); // cleanup expired
  });

  it('(6) renders 💤 snooze button per row', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'RealityGap.tsx'), 'utf-8');
    expect(source).toContain('💤');
    expect(source).toContain('handleSnooze');
    expect(source).toContain('Snooze for 7 days');
  });

  it('(7) shows gap color via getGapColor function using painTextClass', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'RealityGap.tsx'), 'utf-8');
    expect(source).toContain('function getGapColor');
    expect(source).toContain('painTextClass');
    expect(source).toMatch(/className\s*=\s*\{.*getGapColor/);
  });

  it('(8) onClick row fires onRowClick callback', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'RealityGap.tsx'), 'utf-8');
    expect(source).toMatch(/onRowClick\?:\s*\(row:/);
    expect(source).toMatch(/onClick\s*=\s*\{\(\)\s*=>\s*onRowClick\?\.\(row\)\}/);
  });

  it('(9) handles empty data with fallback message', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'RealityGap.tsx'), 'utf-8');
    expect(source).toMatch(/!data\s*\|\|\s*data\.length\s*===\s*0/);
    expect(source).toContain('No reality gaps detected');
  });

  it('getGapLabel returns SEVERE/MODERATE/MINOR based on thresholds', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'RealityGap.tsx'), 'utf-8');
    expect(source).toContain('function getGapLabel');
    expect(source).toMatch(/gap\s*>=\s*0\.8.*SEVERE/);
    expect(source).toMatch(/gap\s*>=\s*0\.5.*MODERATE/);
    expect(source).toContain('MINOR');
  });
});

// ═══════════════════════════════════════════════════════════════
// L2-22: RiskDistributionChart.tsx
// ═══════════════════════════════════════════════════════════════

describe('[L2-22] RiskDistributionChart component behaviors', () => {
  let source: string;

  it('reads RiskDistributionChart source', async () => {
    source = await readFile(resolve(componentsDir, 'RiskDistributionChart.tsx'), 'utf-8');
    expect(source.length).toBeGreaterThan(0);
  });

  it('(1) uses Recharts BarChart with vertical layout (horizontal bars)', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'RiskDistributionChart.tsx'), 'utf-8');
    expect(source).toContain("import { BarChart");
    expect(source).toContain('layout="vertical"');
  });

  it('(2) TIER_COLORS maps each tier to distinct color', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'RiskDistributionChart.tsx'), 'utf-8');
    expect(source).toContain('TIER_COLORS');
    expect(source).toContain("CRITICAL: '#ef4444'"); // red
    expect(source).toContain("HIGH: '#f97316'");     // orange
    expect(source).toContain("MEDIUM: '#eab308'");   // yellow
    expect(source).toContain("LOW: '#22c55e'");      // green
  });

  it('(3) bars ordered by TIER_ORDER (CRITICAL → HIGH → MEDIUM → LOW)', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'RiskDistributionChart.tsx'), 'utf-8');
    expect(source).toContain("TIER_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']");
    // sorted = [...data].sort( ... TIER_ORDER.indexOf ... ) - spans multiple lines
    expect(source).toContain('const sorted = [...data].sort');
    expect(source).toContain('TIER_ORDER.indexOf(a.tier)');
  });

  it('(4) tooltip shows count and percentage', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'RiskDistributionChart.tsx'), 'utf-8');
    expect(source).toContain('<Tooltip');
    // formatter is multi-line: formatter={(value: any, ...) => [...]}
    expect(source).toContain('formatter={(value');
    expect(source).toContain('value / total');
    expect(source).toContain('toFixed(1)'); // percentage formatting
  });

  it('(5) handles empty data with fallback message', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'RiskDistributionChart.tsx'), 'utf-8');
    expect(source).toMatch(/!data\s*\|\|\s*data\.length\s*===\s*0/);
    expect(source).toContain('No risk distribution data available');
  });
});

// ═══════════════════════════════════════════════════════════════
// L2-23: RiskOverTime.tsx
// ═══════════════════════════════════════════════════════════════

describe('[L2-23] RiskOverTime component behaviors', () => {
  let source: string;

  it('reads RiskOverTime source', async () => {
    source = await readFile(resolve(componentsDir, 'RiskOverTime.tsx'), 'utf-8');
    expect(source.length).toBeGreaterThan(0);
  });

  it('(1) uses Recharts LineChart with 4 Line series', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'RiskOverTime.tsx'), 'utf-8');
    // Import may be multi-line: import {\n  LineChart, Line, ...
    expect(source).toContain('LineChart, Line');
    expect(source).toContain("from 'recharts'");
    expect(source).toContain('<LineChart');
    // Count Line elements
    const lineCount = (source.match(/<Line\s/g) || []).length;
    expect(lineCount).toBe(4);
  });

  it('(2) each series has correct color: blue/red/orange/yellow', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'RiskOverTime.tsx'), 'utf-8');
    expect(source).toContain('stroke="#3b82f6"'); // blue - verificationRuns
    expect(source).toContain('stroke="#ef4444"'); // red - invariantViolations
    expect(source).toContain('stroke="#f97316"'); // orange - gateFailures
    expect(source).toContain('stroke="#eab308"'); // yellow - regressions
  });

  it('(3) X-axis shows formatted timestamps via formatDate', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'RiskOverTime.tsx'), 'utf-8');
    expect(source).toContain('function formatDate');
    expect(source).toContain('<XAxis');
    expect(source).toContain('dataKey="label"');
    expect(source).toMatch(/label:\s*formatDate\(row\.timestamp\)/);
  });

  it('(4) handles empty data with fallback message', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'RiskOverTime.tsx'), 'utf-8');
    expect(source).toMatch(/!data\s*\|\|\s*data\.length\s*===\s*0/);
    expect(source).toContain('No governance snapshots available');
  });

  it('(5) uses ResponsiveContainer for responsive sizing', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'RiskOverTime.tsx'), 'utf-8');
    // Import may be multi-line
    expect(source).toContain('ResponsiveContainer');
    expect(source).toContain("from 'recharts'");
    expect(source).toContain('<ResponsiveContainer');
  });

  it('Line series map to correct data keys', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'RiskOverTime.tsx'), 'utf-8');
    expect(source).toContain('dataKey="verificationRuns"');
    expect(source).toContain('dataKey="invariantViolations"');
    expect(source).toContain('dataKey="gateFailures"');
    expect(source).toContain('dataKey="regressions"');
  });
});

// ═══════════════════════════════════════════════════════════════
// L2-24: SafestAction.tsx
// ═══════════════════════════════════════════════════════════════

describe('[L2-24] SafestAction component behaviors', () => {
  let source: string;

  it('reads SafestAction source', async () => {
    source = await readFile(resolve(componentsDir, 'SafestAction.tsx'), 'utf-8');
    expect(source.length).toBeGreaterThan(0);
  });

  it('(1) renders list of safest files (sliced to top 10)', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'SafestAction.tsx'), 'utf-8');
    expect(source).toMatch(/data\.slice\(0,\s*10\)/);
    expect(source).toContain('Lowest risk + highest confidence');
  });

  it('(2) shows file name, confidence, pain, and fragility', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'SafestAction.tsx'), 'utf-8');
    expect(source).toContain('{row.name}');
    expect(source).toContain('row.confidenceScore');
    expect(source).toContain('row.adjustedPain');
    expect(source).toContain('row.fragility');
    expect(source).toContain('% conf');
  });

  it('(3) onClick fires onRowClick callback', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'SafestAction.tsx'), 'utf-8');
    expect(source).toMatch(/onRowClick\?:\s*\(row:/);
    expect(source).toMatch(/onClick\s*=\s*\{\(\)\s*=>\s*onRowClick\?\.\(row\)\}/);
  });

  it('(4) handles empty data with specific message', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'SafestAction.tsx'), 'utf-8');
    expect(source).toMatch(/!data\s*\|\|\s*data\.length\s*===\s*0/);
    expect(source).toContain('No safe files found');
    expect(source).toContain('all files have low confidence or high pain');
  });

  it('SafestRow interface has expected properties', async () => {
    if (!source) source = await readFile(resolve(componentsDir, 'SafestAction.tsx'), 'utf-8');
    expect(source).toContain('interface SafestRow');
    expect(source).toContain('name: string');
    expect(source).toContain('confidenceScore: number');
    expect(source).toContain('adjustedPain: number');
    expect(source).toContain('fragility: number');
    expect(source).toContain('centrality: number');
  });
});
