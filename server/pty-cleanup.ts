import type { IPty } from '@lydell/node-pty';

/** Resource-only cleanup for the pinned @lydell/node-pty 1.1.0 Windows build.
 * Its natural-exit path leaves the output worker and input pipe open. Calling
 * public kill() after exit also enumerates a console that no longer exists.
 * Release the owned handles directly; never send signals to an exited PID.
 */
export function releaseExitedPty(terminal: IPty) {
  if (process.platform !== 'win32') return;
  const agent = (
    terminal as unknown as {
      _agent?: {
        _inSocket: { destroy(): void };
        _conoutSocketWorker: { dispose(): void };
        _ptyNative: { kill(id: number): void };
        _pty: number;
      };
    }
  )._agent;
  if (!agent) return;
  agent._inSocket.destroy();
  agent._conoutSocketWorker.dispose();
  agent._ptyNative.kill(agent._pty);
}
