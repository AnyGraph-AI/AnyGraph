import { execSync } from 'node:child_process';

function run(command: string): void {
  execSync(command, { stdio: 'inherit' });
}

function isWatcherActive(): boolean {
  try {
    const out = execSync('systemctl --user is-active codegraph-watcher.service', { encoding: 'utf8' }).trim();
    return out === 'active';
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const wasActive = isWatcherActive();

  try {
    if (wasActive) {
      console.log('[done-check] Pausing codegraph-watcher.service for quiescent verification...');
      run('systemctl --user stop codegraph-watcher.service');
    }

    run('npm run done-check:core');
  } finally {
    if (wasActive) {
      console.log('[done-check] Resuming codegraph-watcher.service...');
      run('systemctl --user start codegraph-watcher.service');
    }
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
