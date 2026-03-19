import { describe, expect, it } from 'vitest';

import {
  isWatcherActive,
  main,
  run,
} from '../../../../scripts/entry/run-done-check-quiescent.js';

describe('[DONE-CHECK] quiescent wrapper full function coverage', () => {
  it('run executes command with inherited stdio', () => {
    const calls: Array<{ command: string; options: unknown }> = [];
    run('echo hello', ((command: string, options?: unknown) => {
      calls.push({ command, options });
      return Buffer.from('ok') as any;
    }) as any);
    expect(calls).toEqual([{ command: 'echo hello', options: { stdio: 'inherit' } }]);
  });

  it('isWatcherActive returns true when systemctl reports active', () => {
    expect(
      isWatcherActive((() => 'active\n') as any),
    ).toBe(true);
  });

  it('isWatcherActive returns false on non-active response', () => {
    expect(
      isWatcherActive((() => 'inactive\n') as any),
    ).toBe(false);
  });

  it('isWatcherActive returns false when command throws', () => {
    expect(
      isWatcherActive((() => {
        throw new Error('systemctl missing');
      }) as any),
    ).toBe(false);
  });

  it('main stops watcher, runs core, then restarts watcher when active', async () => {
    const commands: string[] = [];
    const logs: string[] = [];

    await main({
      isWatcherActive: () => true,
      run: (command) => {
        commands.push(command);
      },
      log: (message) => logs.push(message),
    });

    expect(commands).toEqual([
      'systemctl --user stop codegraph-watcher.service',
      'npm run done-check:core',
      'systemctl --user start codegraph-watcher.service',
    ]);
    expect(logs.some((l) => l.includes('Pausing'))).toBe(true);
    expect(logs.some((l) => l.includes('Resuming'))).toBe(true);
  });

  it('main runs core only when watcher inactive', async () => {
    const commands: string[] = [];

    await main({
      isWatcherActive: () => false,
      run: (command) => {
        commands.push(command);
      },
      log: () => {},
    });

    expect(commands).toEqual(['npm run done-check:core']);
  });

  it('main resumes watcher in finally when core fails', async () => {
    const commands: string[] = [];

    await expect(
      main({
        isWatcherActive: () => true,
        run: (command) => {
          commands.push(command);
          if (command === 'npm run done-check:core') {
            throw new Error('core failed');
          }
        },
        log: () => {},
      }),
    ).rejects.toThrow('core failed');

    expect(commands).toEqual([
      'systemctl --user stop codegraph-watcher.service',
      'npm run done-check:core',
      'systemctl --user start codegraph-watcher.service',
    ]);
  });
});
