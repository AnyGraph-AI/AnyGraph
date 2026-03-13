/**
 * Watch Manager Service
 * Manages file watchers for incremental graph updates across projects
 * Uses @parcel/watcher for high-performance file watching
 */

import { execFileSync } from 'child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import * as watcher from '@parcel/watcher';
import type { AsyncSubscription } from '@parcel/watcher';

import { WATCH } from '../constants.js';
import { debugLog } from '../utils.js';

export type WatchEventType = 'add' | 'change' | 'unlink';

export interface WatchEvent {
  type: WatchEventType;
  filePath: string;
  timestamp: number;
}

export interface WatcherConfig {
  projectPath: string;
  projectId: string;
  tsconfigPath: string;
  debounceMs: number;
  excludePatterns: string[];
}

export interface WatcherState {
  projectId: string;
  projectPath: string;
  tsconfigPath: string;
  subscription: AsyncSubscription | null;
  config: WatcherConfig;
  pendingEvents: WatchEvent[];
  debounceTimer: ReturnType<typeof setTimeout> | null;
  isProcessing: boolean;
  isStopping: boolean;
  lastUpdateTime: Date | null;
  status: 'active' | 'paused' | 'error';
  errorMessage?: string;
  syncPromise?: Promise<void>;
}

export interface WatcherInfo {
  projectId: string;
  projectPath: string;
  status: 'active' | 'paused' | 'error';
  lastUpdateTime: string | null;
  pendingChanges: number;
  debounceMs: number;
  errorMessage?: string;
}

export interface WatchNotification {
  type:
    | 'file_change_detected'
    | 'incremental_parse_started'
    | 'incremental_parse_completed'
    | 'incremental_parse_failed';
  projectId: string;
  projectPath: string;
  data: {
    filesChanged?: string[];
    filesAdded?: string[];
    filesDeleted?: string[];
    nodesUpdated?: number;
    edgesUpdated?: number;
    elapsedMs?: number;
    error?: string;
  };
  timestamp: string;
}

export type IncrementalParseHandler = (
  projectPath: string,
  projectId: string,
  tsconfigPath: string,
) => Promise<{ nodesUpdated: number; edgesUpdated: number }>;

class WatchManager {
  private watchers: Map<string, WatcherState> = new Map();
  private mcpServer: Server | null = null;
  private incrementalParseHandler: IncrementalParseHandler | null = null;

  /**
   * Set the MCP server instance for sending notifications
   */
  setMcpServer(server: Server): void {
    this.mcpServer = server;
  }

  /**
   * Set the incremental parse handler function
   */
  setIncrementalParseHandler(handler: IncrementalParseHandler): void {
    this.incrementalParseHandler = handler;
  }

  /**
   * Send a notification via MCP logging (if supported)
   */
  private sendNotification(notification: WatchNotification): void {
    debugLog('sendNotification called', { type: notification.type, projectId: notification.projectId });

    if (!this.mcpServer) {
      debugLog('sendNotification: no MCP server, skipping', {});
      return;
    }

    debugLog('sendNotification: sending to MCP', { type: notification.type });

    // sendLoggingMessage returns a Promise - use .catch() to handle rejection
    this.mcpServer
      .sendLoggingMessage({
        level: notification.type.includes('failed') ? 'error' : 'info',
        logger: 'file-watcher',
        data: notification,
      })
      .then(() => {
        debugLog('sendNotification: MCP message sent successfully', { type: notification.type });
      })
      .catch((error) => {
        // MCP logging not supported - log but don't crash
        // This is expected if the client doesn't support logging capability
        debugLog('sendNotification: MCP message failed (expected if client lacks logging)', {
          type: notification.type,
          error: String(error),
        });
      });
  }

  private runProjectCommand(command: string[], timeoutMs = 600000): { ok: boolean; command: string; error?: string } {
    try {
      execFileSync(command[0], command.slice(1), {
        cwd: process.cwd(),
        stdio: 'pipe',
        encoding: 'utf8',
        timeout: timeoutMs,
      });

      return { ok: true, command: command.join(' ') };
    } catch (error) {
      return {
        ok: false,
        command: command.join(' '),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private getLinkedPlanProjectsForCodeProject(codeProjectId: string): string[] {
    try {
      const mapPath = join(process.cwd(), 'config', 'plan-code-project-map.json');
      if (!existsSync(mapPath)) return [];
      const mapping = JSON.parse(readFileSync(mapPath, 'utf8')) as Record<string, string>;
      return Object.entries(mapping)
        .filter(([, pid]) => pid === codeProjectId)
        .map(([planProjectId]) => planProjectId);
    } catch {
      return [];
    }
  }

  private appendRecheckEventLog(entry: Record<string, unknown>): void {
    const dir = join(process.cwd(), 'artifacts');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'watcher-recheck-events.jsonl');
    appendFileSync(path, `${JSON.stringify(entry)}\n`, 'utf8');
  }

  private async triggerLiveRecheckPipeline(
    state: WatcherState,
    events: WatchEvent[],
    parseResult: { nodesUpdated: number; edgesUpdated: number },
  ): Promise<void> {
    const changedPaths = events.filter((e) => e.type !== 'unlink').map((e) => e.filePath.toLowerCase());
    const hasCodeFileChange = changedPaths.some((p) => p.endsWith('.ts') || p.endsWith('.tsx'));
    const hasPlanFileChange = changedPaths.some((p) => p.includes('/plans/') && p.endsWith('.md'));

    const linkedPlanProjects = this.getLinkedPlanProjectsForCodeProject(state.projectId);
    const commandResults: Array<{ ok: boolean; command: string; error?: string }> = [];

    if (hasCodeFileChange && linkedPlanProjects.length > 0) {
      commandResults.push(this.runProjectCommand(['npm', 'run', 'plan:evidence:recompute']));
    }

    if (hasPlanFileChange) {
      commandResults.push(this.runProjectCommand(['npm', 'run', 'plan:refresh']));
      commandResults.push(this.runProjectCommand(['npm', 'run', 'plan:evidence:recompute']));
    }

    const evidenceChanged =
      parseResult.nodesUpdated > 0 ||
      parseResult.edgesUpdated > 0 ||
      commandResults.some((r) => r.ok && r.command.includes('plan:evidence:recompute'));

    if (evidenceChanged) {
      commandResults.push(this.runProjectCommand(['node', '--loader', 'ts-node/esm', 'src/core/claims/claim-engine.ts']));
      commandResults.push(this.runProjectCommand(['npm', 'run', 'claims:cross:synthesize']));
    }

    this.appendRecheckEventLog({
      timestamp: new Date().toISOString(),
      projectId: state.projectId,
      events: events.map((e) => ({ type: e.type, filePath: e.filePath })),
      linkedPlanProjects,
      parseResult,
      hasCodeFileChange,
      hasPlanFileChange,
      evidenceChanged,
      commandResults,
    });
  }

  /**
   * Start watching a project for file changes
   */
  async startWatching(
    config: Partial<WatcherConfig> & { projectPath: string; projectId: string; tsconfigPath: string },
  ): Promise<WatcherInfo> {
    // Check if already watching this project
    if (this.watchers.has(config.projectId)) {
      const existing = this.watchers.get(config.projectId)!;
      return this.getWatcherInfoFromState(existing);
    }

    // Enforce maximum watcher limit
    if (this.watchers.size >= WATCH.maxWatchers) {
      throw new Error(
        `Maximum watcher limit (${WATCH.maxWatchers}) reached. ` +
          `Stop an existing watcher before starting a new one.`,
      );
    }

    const fullConfig: WatcherConfig = {
      projectPath: config.projectPath,
      projectId: config.projectId,
      tsconfigPath: config.tsconfigPath,
      debounceMs: config.debounceMs ?? WATCH.defaultDebounceMs,
      excludePatterns: config.excludePatterns ?? [...WATCH.excludePatterns],
    };

    await debugLog('Creating @parcel/watcher subscription', {
      watchPath: fullConfig.projectPath,
      ignored: fullConfig.excludePatterns,
    });

    // Create state object first (subscription will be added after)
    const state: WatcherState = {
      projectId: fullConfig.projectId,
      projectPath: fullConfig.projectPath,
      tsconfigPath: fullConfig.tsconfigPath,
      subscription: null, // Will be set after successful subscription
      config: fullConfig,
      pendingEvents: [],
      debounceTimer: null,
      isProcessing: false,
      isStopping: false,
      lastUpdateTime: null,
      status: 'active',
    };

    try {
      // Subscribe to file changes using @parcel/watcher
      const subscription = await watcher.subscribe(
        fullConfig.projectPath,
        (err, events) => {
          if (err) {
            this.handleWatcherError(state, err);
            return;
          }

          for (const event of events) {
            try {
              // Filter for relevant files (TypeScript + plan markdown)
              const isTypeScript = event.path.endsWith('.ts') || event.path.endsWith('.tsx');
              const isPlanMarkdown = event.path.endsWith('.md') && event.path.includes('/plans/');
              if (!isTypeScript && !isPlanMarkdown) {
                continue;
              }

              // Map parcel event types to our event types
              let eventType: WatchEventType;
              if (event.type === 'create') {
                eventType = 'add';
              } else if (event.type === 'delete') {
                eventType = 'unlink';
              } else {
                eventType = 'change';
              }

              this.handleFileEvent(state, eventType, event.path);
            } catch (error) {
              debugLog('Error processing file event', { error: String(error), path: event.path });
            }
          }
        },
        {
          ignore: fullConfig.excludePatterns,
        },
      );

      state.subscription = subscription;
      this.watchers.set(fullConfig.projectId, state);

      await debugLog('Watcher started', { projectId: fullConfig.projectId, projectPath: fullConfig.projectPath });

      // Check for changes that occurred while watcher was off (run in background)
      this.syncMissedChanges(state);

      return this.getWatcherInfoFromState(state);
    } catch (error) {
      await debugLog('Failed to start watcher', { error: String(error) });
      throw error;
    }
  }

  /**
   * Handle a file system event
   */
  private handleFileEvent(state: WatcherState, type: WatchEventType, filePath: string): void {
    debugLog('handleFileEvent START', {
      type,
      filePath,
      projectId: state.projectId,
      status: state.status,
      isStopping: state.isStopping,
    });

    // Ignore events if watcher is stopping or not active
    if (state.isStopping || state.status !== 'active') {
      debugLog('Ignoring event - watcher not active or stopping', {
        status: state.status,
        isStopping: state.isStopping,
      });
      return;
    }

    const event: WatchEvent = {
      type,
      filePath,
      timestamp: Date.now(),
    };

    // Prevent unbounded event accumulation - drop oldest events if buffer is full
    if (state.pendingEvents.length >= WATCH.maxPendingEvents) {
      debugLog('Event buffer full, dropping oldest events', { projectId: state.projectId });
      state.pendingEvents = state.pendingEvents.slice(-Math.floor(WATCH.maxPendingEvents / 2));
    }

    state.pendingEvents.push(event);
    debugLog('Event added to pending', { pendingCount: state.pendingEvents.length });

    // Clear existing debounce timer
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
    }

    // Send immediate notification about file change detected
    this.sendNotification({
      type: 'file_change_detected',
      projectId: state.projectId,
      projectPath: state.projectPath,
      data: {
        filesChanged: state.pendingEvents.filter((e) => e.type === 'change').map((e) => e.filePath),
        filesAdded: state.pendingEvents.filter((e) => e.type === 'add').map((e) => e.filePath),
        filesDeleted: state.pendingEvents.filter((e) => e.type === 'unlink').map((e) => e.filePath),
      },
      timestamp: new Date().toISOString(),
    });

    // Set new debounce timer
    debugLog('handleFileEvent: setting debounce timer', { debounceMs: state.config.debounceMs });
    state.debounceTimer = setTimeout(() => {
      debugLog('handleFileEvent: debounce timer fired, calling processEvents', { projectId: state.projectId });
      this.processEvents(state).catch((error) => {
        debugLog('handleFileEvent: processEvents error', { error: String(error) });
        console.error('[WatchManager] Error in processEvents:', error);
      });
    }, state.config.debounceMs);
    debugLog('handleFileEvent END', { pendingCount: state.pendingEvents.length });
  }

  /**
   * Process accumulated file events after debounce period
   */
  private async processEvents(state: WatcherState): Promise<void> {
    await debugLog('processEvents START', {
      projectId: state.projectId,
      isProcessing: state.isProcessing,
      pendingCount: state.pendingEvents.length,
      isStopping: state.isStopping,
    });

    // Don't process if already processing, no events, or watcher is stopping
    if (state.isProcessing || state.pendingEvents.length === 0 || state.isStopping) {
      await debugLog('processEvents: early return', {
        reason: state.isProcessing ? 'already processing' : state.pendingEvents.length === 0 ? 'no events' : 'stopping',
      });
      return;
    }

    state.isProcessing = true;
    await debugLog('processEvents: set isProcessing=true', {});
    const events = [...state.pendingEvents];
    state.pendingEvents = [];
    state.debounceTimer = null;

    const startTime = Date.now();

    this.sendNotification({
      type: 'incremental_parse_started',
      projectId: state.projectId,
      projectPath: state.projectPath,
      data: {
        filesChanged: events.filter((e) => e.type === 'change').map((e) => e.filePath),
        filesAdded: events.filter((e) => e.type === 'add').map((e) => e.filePath),
        filesDeleted: events.filter((e) => e.type === 'unlink').map((e) => e.filePath),
      },
      timestamp: new Date().toISOString(),
    });

    try {
      if (!this.incrementalParseHandler) {
        throw new Error('Incremental parse handler not configured');
      }

      await debugLog('processEvents: calling incrementalParseHandler', {
        projectPath: state.projectPath,
        projectId: state.projectId,
      });
      const result = await this.incrementalParseHandler(state.projectPath, state.projectId, state.tsconfigPath);
      await debugLog('processEvents: incrementalParseHandler returned', {
        nodesUpdated: result.nodesUpdated,
        edgesUpdated: result.edgesUpdated,
      });

      // Post-incremental enrichment: recompute metrics on affected nodes
      if (result.nodesUpdated > 0 || result.edgesUpdated > 0) {
        await this.runPostIncrementalEnrichment(state.projectId);
      }

      // Live re-check pipeline hooks (Milestone 6)
      await this.triggerLiveRecheckPipeline(state, events, result);

      state.lastUpdateTime = new Date();
      const elapsedMs = Date.now() - startTime;

      this.sendNotification({
        type: 'incremental_parse_completed',
        projectId: state.projectId,
        projectPath: state.projectPath,
        data: {
          filesChanged: events.filter((e) => e.type === 'change').map((e) => e.filePath),
          filesAdded: events.filter((e) => e.type === 'add').map((e) => e.filePath),
          filesDeleted: events.filter((e) => e.type === 'unlink').map((e) => e.filePath),
          nodesUpdated: result.nodesUpdated,
          edgesUpdated: result.edgesUpdated,
          elapsedMs,
        },
        timestamp: new Date().toISOString(),
      });

      console.error(
        `[WatchManager] Incremental parse completed for ${state.projectId}: ` +
          `${result.nodesUpdated} nodes, ${result.edgesUpdated} edges in ${elapsedMs}ms`,
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await debugLog('processEvents: error caught', { error: errorMessage });

      this.sendNotification({
        type: 'incremental_parse_failed',
        projectId: state.projectId,
        projectPath: state.projectPath,
        data: {
          error: errorMessage,
          elapsedMs: Date.now() - startTime,
        },
        timestamp: new Date().toISOString(),
      });

      console.error(`[WatchManager] Incremental parse failed for ${state.projectId}:`, error);
    } finally {
      state.isProcessing = false;
      await debugLog('processEvents END', { projectId: state.projectId, isProcessing: state.isProcessing });
    }
  }

  /**
   * Handle watcher error
   */
  private handleWatcherError(state: WatcherState, error: unknown): void {
    state.status = 'error';
    state.errorMessage = error instanceof Error ? error.message : String(error);
    debugLog('handleWatcherError START', { projectId: state.projectId, error: state.errorMessage });

    // Clean up the failed watcher to prevent it from staying in error state indefinitely
    this.stopWatching(state.projectId)
      .then(() => {
        debugLog('handleWatcherError: cleanup succeeded', { projectId: state.projectId });
      })
      .catch((cleanupError) => {
        debugLog('handleWatcherError: cleanup failed', {
          projectId: state.projectId,
          cleanupError: String(cleanupError),
        });
        console.error(`[WatchManager] Failed to cleanup errored watcher ${state.projectId}:`, cleanupError);
      });
  }

  /**
   * Sync any changes that occurred while the watcher was off
   * Runs in the background without blocking watcher startup
   * Promise is tracked on state to allow cleanup during stop
   */
  private syncMissedChanges(state: WatcherState): void {
    debugLog('syncMissedChanges START', { projectId: state.projectId });
    if (!this.incrementalParseHandler) {
      debugLog('syncMissedChanges: no handler, skipping', {});
      return;
    }

    // Track the promise on state so stopWatching can wait for it
    state.syncPromise = this.incrementalParseHandler(state.projectPath, state.projectId, state.tsconfigPath)
      .then((result) => {
        debugLog('syncMissedChanges: completed', {
          projectId: state.projectId,
          nodesUpdated: result.nodesUpdated,
          edgesUpdated: result.edgesUpdated,
        });
        if (result.nodesUpdated > 0 || result.edgesUpdated > 0) {
          console.error(
            `[WatchManager] Synced missed changes for ${state.projectId}: ` +
              `${result.nodesUpdated} nodes, ${result.edgesUpdated} edges`,
          );
        }
      })
      .catch((error) => {
        debugLog('syncMissedChanges: error', {
          projectId: state.projectId,
          error: String(error),
          isStopping: state.isStopping,
        });
        // Only log if watcher hasn't been stopped
        if (!state.isStopping) {
          console.error(`[WatchManager] Failed to sync missed changes for ${state.projectId}:`, error);
        }
      })
      .finally(() => {
        debugLog('syncMissedChanges END', { projectId: state.projectId });
        state.syncPromise = undefined;
      });
  }

  /**
   * Stop watching a project
   * Waits for any in-progress processing to complete before cleanup
   */
  async stopWatching(projectId: string): Promise<boolean> {
    const state = this.watchers.get(projectId);
    if (!state) {
      return false;
    }

    // Mark as stopping to prevent new event processing
    state.isStopping = true;
    state.status = 'paused';

    // Clear debounce timer
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = null;
    }

    // Wait for any in-progress processing to complete (with timeout)
    const maxWaitMs = 30000; // 30 second timeout
    const startTime = Date.now();
    while (state.isProcessing && Date.now() - startTime < maxWaitMs) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Wait for sync promise if it exists (with timeout)
    if (state.syncPromise) {
      try {
        await Promise.race([
          state.syncPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Sync timeout')), 5000)),
        ]);
      } catch {
        // Timeout or error - continue with cleanup
      }
    }

    // Unsubscribe from @parcel/watcher (only if subscription exists)
    if (state.subscription) {
      try {
        await state.subscription.unsubscribe();
      } catch (error) {
        console.warn(`[WatchManager] Error unsubscribing watcher for ${projectId}:`, error);
      }
    }

    this.watchers.delete(projectId);

    console.error(`[WatchManager] Stopped watching project: ${projectId}`);

    return true;
  }

  /**
   * Get watcher info for a project
   */
  getWatcherInfo(projectId: string): WatcherInfo | undefined {
    const state = this.watchers.get(projectId);
    if (!state) return undefined;
    return this.getWatcherInfoFromState(state);
  }

  /**
   * List all active watchers
   */
  listWatchers(): WatcherInfo[] {
    return Array.from(this.watchers.values()).map((state) => this.getWatcherInfoFromState(state));
  }

  /**
   * Stop all watchers (for shutdown)
   */
  async stopAllWatchers(): Promise<void> {
    const projectIds = Array.from(this.watchers.keys());
    await Promise.all(projectIds.map((id) => this.stopWatching(id)));
    console.error(`[WatchManager] Stopped all ${projectIds.length} watchers`);
  }

  /**
   * Run lightweight post-incremental enrichment on changed nodes.
   * Recomputes fanIn/fanOut, riskLevel, riskTier for the entire project.
   * This is fast (~50-100ms) because it runs on the existing graph.
   */
  private async runPostIncrementalEnrichment(projectId: string): Promise<void> {
    try {
      const { Neo4jService } = await import('../../storage/neo4j/neo4j.service.js');
      const neo4j = new Neo4jService();
      
      // 1. Recompute fanIn/fanOut
      await neo4j.run(`
        MATCH (fn:CodeNode {projectId: $projectId})
        WHERE fn.riskLevel IS NOT NULL OR fn:Function OR fn:Method
        OPTIONAL MATCH (caller)-[:CALLS]->(fn)
        WITH fn, count(DISTINCT caller) AS fanIn
        OPTIONAL MATCH (fn)-[:CALLS]->(callee)
        WITH fn, fanIn, count(DISTINCT callee) AS fanOut
        SET fn.fanInCount = fanIn, fn.fanOutCount = fanOut
      `, { projectId });
      
      // 2. Recompute riskLevel
      await neo4j.run(`
        MATCH (fn:CodeNode {projectId: $projectId})
        WHERE fn.fanInCount IS NOT NULL AND fn.fanOutCount IS NOT NULL
        WITH fn,
          fn.fanInCount * fn.fanOutCount * log(toFloat(coalesce(fn.lineCount, 1)) + 1.0) AS baseRisk,
          coalesce(fn.temporalCoupling, 0) AS tc,
          coalesce(fn.authorEntropy, 1) AS ae
        SET fn.riskLevel = baseRisk * (1.0 + tc * 0.1) * (1.0 + (ae - 1) * 0.15),
            fn.riskTier = CASE
              WHEN baseRisk * (1.0 + tc * 0.1) * (1.0 + (ae - 1) * 0.15) > 500 THEN 'CRITICAL'
              WHEN baseRisk * (1.0 + tc * 0.1) * (1.0 + (ae - 1) * 0.15) > 100 THEN 'HIGH'
              WHEN baseRisk * (1.0 + tc * 0.1) * (1.0 + (ae - 1) * 0.15) > 20 THEN 'MEDIUM'
              ELSE 'LOW'
            END
      `, { projectId });
      
      // 3. Cross-file classification on CALLS edges
      await neo4j.run(`
        MATCH (src:CodeNode {projectId: $projectId})-[r:CALLS]->(tgt:CodeNode)
        SET r.crossFile = (src.filePath <> tgt.filePath)
      `, { projectId });
      
      // 4. Registration property promotion (for Grammy/framework handlers)
      await neo4j.run(`
        MATCH (e:Entrypoint {projectId: $projectId})
        WHERE e.context IS NOT NULL
        WITH e, apoc.convert.fromJsonMap(e.context) AS ctx
        SET e.registrationKind = ctx.entrypointKind,
            e.registrationTrigger = ctx.trigger,
            e.framework = ctx.framework
        WITH count(e) AS done
        MATCH (h {projectId: $projectId})-[:REGISTERED_BY]->(e2:Entrypoint)
        WHERE e2.registrationKind IS NOT NULL
        SET h.registrationKind = e2.registrationKind,
            h.registrationTrigger = e2.registrationTrigger
      `, { projectId });
      
      console.error(`[WatchManager] Post-incremental enrichment complete for ${projectId}`);
    } catch (error) {
      console.error(`[WatchManager] Post-incremental enrichment failed: ${error}`);
      // Non-fatal — the parse still succeeded
    }
  }

  /**
   * Convert internal state to public info
   */
  private getWatcherInfoFromState(state: WatcherState): WatcherInfo {
    return {
      projectId: state.projectId,
      projectPath: state.projectPath,
      status: state.status,
      lastUpdateTime: state.lastUpdateTime?.toISOString() ?? null,
      pendingChanges: state.pendingEvents.length,
      debounceMs: state.config.debounceMs,
      errorMessage: state.errorMessage,
    };
  }
}

// Singleton instance
export const watchManager = new WatchManager();
