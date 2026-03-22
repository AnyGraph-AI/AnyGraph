/**
 * filename-disambig.ts — shortest unique suffix disambiguation
 *
 * Given a list of file paths, produces the shortest path suffix that
 * uniquely identifies each path. If a basename is unique, it's used as-is.
 * If multiple files share the same basename, parent segments are added until
 * each path is unique.
 *
 * Example:
 *   Input:  ['src/api/route.ts', 'src/graph/query/route.ts', 'src/utils/helper.ts']
 *   Output: Map {
 *     'src/api/route.ts'         → 'api/route.ts',
 *     'src/graph/query/route.ts' → 'query/route.ts',
 *     'src/utils/helper.ts'      → 'helper.ts',
 *   }
 */

/**
 * Returns a Map from each path to its shortest unique suffix.
 * All paths that are unique by basename get just the basename.
 * Colliding paths get progressively more prefix segments added.
 */
export function shortestUniqueSuffix(paths: string[]): Map<string, string> {
  const result = new Map<string, string>();
  if (paths.length === 0) return result;

  // Split each path into segments (filter empty from leading slash)
  const segmented = paths.map(p => ({
    original: p,
    parts: p.replace(/\\/g, '/').split('/').filter(Boolean),
  }));

  // Start with depth 1 (just the basename), increase until all are unique
  const maxDepth = Math.max(...segmented.map(s => s.parts.length));

  for (let depth = 1; depth <= maxDepth; depth++) {
    // Build candidate suffix for each path at this depth
    const candidates = segmented.map(s => ({
      original: s.original,
      suffix: s.parts.slice(-depth).join('/'),
    }));

    // Count occurrences of each suffix
    const counts = new Map<string, number>();
    for (const c of candidates) {
      counts.set(c.suffix, (counts.get(c.suffix) ?? 0) + 1);
    }

    // Assign unique suffixes; leave ambiguous ones for deeper depth
    for (const c of candidates) {
      if (!result.has(c.original) && counts.get(c.suffix) === 1) {
        result.set(c.original, c.suffix);
      }
    }

    // If all resolved, done
    if (result.size === paths.length) break;
  }

  // Any still-unresolved paths (e.g., exact duplicate paths): use full path
  for (const s of segmented) {
    if (!result.has(s.original)) {
      result.set(s.original, s.original);
    }
  }

  return result;
}
