'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape';
import cola from 'cytoscape-cola';

cytoscape.use(cola);

type Mode = 'neighbors' | 'danger-paths';

type GraphNode = {
  id: string;
  name: string;
  filePath: string;
  labels: string[];
  riskTier: string;
};

type GraphEdge = {
  source: string;
  target: string;
  type: string;
};

type GraphResponse = {
  data: {
    rootId: string;
    seed: string;
    mode: Mode;
    nodes: GraphNode[];
    edges: GraphEdge[];
    nodeCount: number;
    edgeCount: number;
    apiNodeCap: number;
    absoluteNodeCap: number;
    truncated: boolean;
  };
};

const RISK_TIERS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;

function nodeType(labels: string[]): string {
  if (labels.includes('SourceFile')) return 'SourceFile';
  if (labels.includes('Function')) return 'Function';
  if (labels.includes('Task')) return 'Task';
  if (labels.includes('TestFile')) return 'TestFile';
  return labels[labels.length - 1] ?? 'Node';
}

function riskColor(tier: string): string {
  switch (tier) {
    case 'CRITICAL':
      return '#ef4444';
    case 'HIGH':
      return '#f97316';
    case 'MEDIUM':
      return '#eab308';
    default:
      return '#7ec8e3';
  }
}

function nodeShape(type: string): string {
  switch (type) {
    case 'SourceFile':
      return 'round-rectangle';
    case 'Function':
      return 'ellipse';
    case 'Task':
      return 'diamond';
    case 'TestFile':
      return 'tag';
    default:
      return 'hexagon';
  }
}

function shortName(name: string): string {
  return name.length > 28 ? `${name.slice(0, 28)}…` : name;
}

export function ExplorerGraph() {
  const params = useSearchParams();
  const focus = params.get('focus') ?? params.get('filePath') ?? params.get('nodeId') ?? '';

  const [resolvedFocus, setResolvedFocus] = useState('');
  const [mode, setMode] = useState<Mode>('neighbors');
  const [graph, setGraph] = useState<GraphResponse['data'] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [labelFilter, setLabelFilter] = useState<Set<string>>(new Set());
  const [riskFilter, setRiskFilter] = useState<Set<string>>(new Set(RISK_TIERS));
  const [nameSearch, setNameSearch] = useState('');
  const [collapseLowMedium, setCollapseLowMedium] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const lastTapRef = useRef<{ id: string; ts: number } | null>(null);

  const fetchGraph = useCallback(async (seed: string, nextMode: Mode) => {
    if (!seed) return;
    setLoading(true);
    setError(null);

    try {
      const encoded = encodeURIComponent(seed);
      const endpoint =
        nextMode === 'neighbors'
          ? `/api/graph/subgraph/${encoded}`
          : `/api/graph/danger-paths/${encoded}`;

      const res = await fetch(endpoint);
      if (!res.ok) {
        throw new Error(`Explorer API failed (${res.status})`);
      }
      const json = (await res.json()) as GraphResponse;
      setGraph(json.data);

      const labels = new Set<string>();
      for (const n of json.data.nodes) labels.add(nodeType(n.labels));
      setLabelFilter(labels);
    } catch (e) {
      setError(String(e));
      setGraph(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const resolveFocus = async () => {
      if (focus) {
        setResolvedFocus(focus);
        return;
      }

      try {
        const res = await fetch('/api/graph/explorer-default');
        if (!res.ok) {
          if (!cancelled) setResolvedFocus('');
          return;
        }
        const json = (await res.json()) as {
          data?: { focus?: string } | null;
        };
        if (!cancelled) setResolvedFocus(json.data?.focus ?? '');
      } catch {
        if (!cancelled) setResolvedFocus('');
      }
    };

    void resolveFocus();

    return () => {
      cancelled = true;
    };
  }, [focus]);

  useEffect(() => {
    if (!resolvedFocus) return;
    void fetchGraph(resolvedFocus, mode);
  }, [resolvedFocus, mode, fetchGraph]);

  const filtered = useMemo(() => {
    if (!graph) return { nodes: [] as GraphNode[], edges: [] as GraphEdge[] };

    const keep = graph.nodes.filter((n) => {
      const type = nodeType(n.labels);
      const matchesLabel = labelFilter.has(type);
      const matchesRisk = riskFilter.has(n.riskTier ?? 'LOW');
      const matchesName =
        nameSearch.trim().length === 0 ||
        n.name.toLowerCase().includes(nameSearch.toLowerCase()) ||
        n.filePath.toLowerCase().includes(nameSearch.toLowerCase());
      return matchesLabel && matchesRisk && matchesName;
    });

    let nodes = keep;
    let edges = graph.edges.filter(
      (e) => keep.some((n) => n.id === e.source) && keep.some((n) => n.id === e.target),
    );

    if (collapseLowMedium) {
      const rootId = graph.rootId;
      const collapse = new Set(
        keep
          .filter(
            (n) => n.id !== rootId && (n.riskTier === 'LOW' || n.riskTier === 'MEDIUM'),
          )
          .map((n) => n.id),
      );

      if (collapse.size > 0) {
        const superNodeId = '__other_low_medium__';
        nodes = [
          ...keep.filter((n) => !collapse.has(n.id)),
          {
            id: superNodeId,
            name: `Other (${collapse.size} low/medium)` ,
            filePath: '',
            labels: ['AggregateNode'],
            riskTier: 'LOW',
          },
        ];

        const edgeSet = new Set<string>();
        const collapsed: GraphEdge[] = [];
        for (const edge of graph.edges) {
          const src = collapse.has(edge.source) ? superNodeId : edge.source;
          const dst = collapse.has(edge.target) ? superNodeId : edge.target;
          if (src === dst) continue;
          if (!nodes.some((n) => n.id === src) || !nodes.some((n) => n.id === dst)) continue;
          const key = `${src}|${dst}|${edge.type}`;
          if (edgeSet.has(key)) continue;
          edgeSet.add(key);
          collapsed.push({ source: src, target: dst, type: edge.type });
        }
        edges = collapsed;
      }
    }

    return { nodes, edges };
  }, [graph, labelFilter, riskFilter, nameSearch, collapseLowMedium]);

  const renderBlocked = filtered.nodes.length > 500;
  const coldStart = !focus && !resolvedFocus && !loading && !error && !graph;

  useEffect(() => {
    if (!containerRef.current || !graph || renderBlocked) return;

    cyRef.current?.destroy();

    const elements: ElementDefinition[] = [
      ...filtered.nodes.map((n) => ({
        data: {
          id: n.id,
          label: shortName(n.name || n.id),
          fullName: n.name,
          filePath: n.filePath,
          riskTier: n.riskTier,
          nodeType: nodeType(n.labels),
          color: riskColor(n.riskTier),
          shapeHint: nodeShape(nodeType(n.labels)),
        },
        classes: nodeType(n.labels),
      })),
      ...filtered.edges.map((e, i) => ({
        data: {
          id: `e-${i}-${e.source}-${e.target}-${e.type}`,
          source: e.source,
          target: e.target,
          edgeType: e.type,
        },
      })),
    ];

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            shape: 'ellipse',
            label: 'data(label)',
            color: '#e4e4e7',
            'font-size': '10px',
            'text-wrap': 'wrap',
            'text-max-width': '80px',
            'text-valign': 'center',
            'text-halign': 'center',
            width: '32px',
            height: '32px',
            'border-width': '1px',
            'border-color': '#27272a',
          },
        },
        {
          selector: '.SourceFile',
          style: { shape: 'round-rectangle' },
        },
        {
          selector: '.Function',
          style: { shape: 'ellipse' },
        },
        {
          selector: '.Task',
          style: { shape: 'diamond' },
        },
        {
          selector: '.TestFile',
          style: { shape: 'tag' },
        },
        {
          selector: '.AggregateNode',
          style: { shape: 'hexagon' },
        },
        {
          selector: 'edge',
          style: {
            width: '1.2px',
            'line-color': '#3f3f46',
            'target-arrow-color': '#3f3f46',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            label: 'data(edgeType)',
            'font-size': '8px',
            color: '#71717a',
            'text-rotation': 'autorotate',
          },
        },
        {
          selector: `node[id = "${graph.rootId}"]`,
          style: {
            'border-color': '#7ec8e3',
            'border-width': '3px',
            width: '42px',
            height: '42px',
          },
        },
      ],
      layout: {
        name: 'cola',
        animate: true,
        randomize: false,
        maxSimulationTime: 1500,
        nodeSpacing: 12,
        edgeLengthVal: 90,
      } as any,
    });

    cy.on('tap', 'node', (evt) => {
      const id = evt.target.id();
      const now = Date.now();
      if (lastTapRef.current && lastTapRef.current.id === id && now - lastTapRef.current.ts < 300) {
        void fetchGraph(id, 'neighbors');
      }
      lastTapRef.current = { id, ts: now };
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [graph, filtered, renderBlocked, fetchGraph]);

  const availableTypes = useMemo(() => {
    if (!graph) return [] as string[];
    return Array.from(new Set(graph.nodes.map((n) => nodeType(n.labels)))).sort();
  }, [graph]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <div>
          <p className="text-xs text-zinc-500 uppercase tracking-[0.1em]">Mode</p>
          <div className="mt-1 flex rounded-md border border-zinc-700 p-0.5">
            {(['neighbors', 'danger-paths'] as const).map((m) => (
              <button
                key={m}
                className={`px-2 py-1 text-xs rounded ${mode === m ? 'bg-[#7ec8e3]/20 text-[#7ec8e3]' : 'text-zinc-400'}`}
                onClick={() => setMode(m)}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs text-zinc-500 uppercase tracking-[0.1em]">Search</p>
          <input
            value={nameSearch}
            onChange={(e) => setNameSearch(e.target.value)}
            className="mt-1 h-8 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100"
            placeholder="Filter by name/path"
          />
        </div>

        <div>
          <p className="text-xs text-zinc-500 uppercase tracking-[0.1em]">Risk tiers</p>
          <div className="mt-1 flex gap-1">
            {RISK_TIERS.map((tier) => {
              const active = riskFilter.has(tier);
              return (
                <button
                  key={tier}
                  onClick={() => {
                    setRiskFilter((prev) => {
                      const next = new Set(prev);
                      if (next.has(tier)) next.delete(tier);
                      else next.add(tier);
                      return next;
                    });
                  }}
                  className={`px-2 py-1 text-[11px] rounded border ${active ? 'border-[#7ec8e3]/50 text-[#7ec8e3]' : 'border-zinc-700 text-zinc-400'}`}
                >
                  {tier}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="text-xs text-zinc-500 uppercase tracking-[0.1em]">Node types</p>
          <div className="mt-1 flex flex-wrap gap-1 max-w-[560px]">
            {availableTypes.map((type) => {
              const active = labelFilter.has(type);
              return (
                <button
                  key={type}
                  onClick={() => {
                    setLabelFilter((prev) => {
                      const next = new Set(prev);
                      if (next.has(type)) next.delete(type);
                      else next.add(type);
                      return next;
                    });
                  }}
                  className={`px-2 py-1 text-[11px] rounded border ${active ? 'border-[#7ec8e3]/50 text-[#7ec8e3]' : 'border-zinc-700 text-zinc-400'}`}
                >
                  {type}
                </button>
              );
            })}
          </div>
        </div>

        <label className="ml-auto flex items-center gap-2 text-xs text-zinc-400">
          <input
            type="checkbox"
            checked={collapseLowMedium}
            onChange={(e) => setCollapseLowMedium(e.target.checked)}
          />
          Collapse LOW/MEDIUM nodes
        </label>
      </div>

      {loading && <div className="text-sm text-zinc-500">Loading explorer graph…</div>}
      {error && <div className="text-sm text-red-400">{error}</div>}

      {graph && (
        <div className="text-xs text-zinc-500 font-mono flex flex-wrap gap-4">
          <span>seed: {graph.seed}</span>
          <span>root: {graph.rootId}</span>
          <span>nodes: {filtered.nodes.length}</span>
          <span>edges: {filtered.edges.length}</span>
          {graph.truncated ? <span className="text-amber-400">API cap reached ({graph.apiNodeCap})</span> : null}
          {filtered.nodes.length >= 150 && filtered.nodes.length <= 180 ? (
            <span className="text-amber-400">Warning: dense graph (150-180 nodes)</span>
          ) : null}
        </div>
      )}

      {coldStart ? (
        <div className="rounded-xl border border-white/10 bg-[#0b0f14] p-6 text-sm text-zinc-400 space-y-2">
          <p className="text-zinc-200 font-medium">Explorer is waiting for a node focus.</p>
          <p>Pick a file/function from dashboard panels, or wait for default seed resolution.</p>
          <p className="text-xs font-mono text-zinc-500">Tip: open with <span className="text-[#7ec8e3]">/explorer?focus=...&focusType=file</span></p>
        </div>
      ) : renderBlocked ? (
        <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-4 text-sm text-red-300">
          Render blocked: node count exceeded 500. Tighten filters before rendering.
        </div>
      ) : (
        <div ref={containerRef} className="h-[70vh] min-h-[480px] rounded-xl border border-white/10 bg-[#0b0f14]" />
      )}

      <p className="text-xs text-zinc-500">Tip: double-click a node to expand neighbors from that node.</p>
    </div>
  );
}
