import { execSync } from 'node:child_process';

export function run(
  command: string,
  exec: typeof execSync = execSync,
): void {
  exec(command, { stdio: 'inherit' });
}

export function isWatcherActive(
  exec: typeof execSync = execSync,
): boolean {
  try {
    const out = exec('systemctl --user is-active codegraph-watcher.service', { encoding: 'utf8' }).trim();
    return out === 'active';
  } catch {
    return false;
  }
}

export async function main(deps?: {
  run?: (command: string) => void;
  isWatcherActive?: () => boolean;
  log?: (message: string) => void;
}): Promise<void> {
  const doRun = deps?.run ?? run;
  const watcherActive = deps?.isWatcherActive ?? isWatcherActive;
  const log = deps?.log ?? ((message: string) => console.log(message));

  const wasActive = watcherActive();

  try {
    if (wasActive) {
      log('[done-check] Pausing codegraph-watcher.service for quiescent verification...');
      doRun('systemctl --user stop codegraph-watcher.service');
    }

    doRun('npm run done-check:core');
  } finally {
    if (wasActive) {
      log('[done-check] Resuming codegraph-watcher.service...');
      doRun('systemctl --user start codegraph-watcher.service');
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exit(1);
  });
}
