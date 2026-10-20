import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

export type TerminalEvent = { id: string; data: string; reset?: boolean };
export default function TerminalView({
  id,
  connected,
  send,
  subscribeOutput,
}: {
  id: string;
  connected: boolean;
  send: (value: unknown) => void;
  subscribeOutput: (listener: (event: TerminalEvent) => void) => () => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let dispose = () => {};
    const frame = requestAnimationFrame(() => {
      const terminal = new Terminal({
        cursorBlink: true,
        cursorStyle: 'bar',
        fontFamily: '"Cascadia Code", "SFMono-Regular", Consolas, monospace',
        fontSize: 12,
        lineHeight: 1.5,
        scrollback: 4000,
        convertEol: false,
        theme: {
          background: '#101418',
          foreground: '#c8d1d9',
          cursor: '#a4e5cd',
          selectionBackground: '#27453e',
          black: '#171c22',
          red: '#e99292',
          green: '#9ddbb6',
          yellow: '#dfc28c',
          blue: '#9bbfee',
          magenta: '#c6abe8',
          cyan: '#94d8da',
          white: '#dde4e9',
        },
      });
      const fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.open(element.current!);
      const resize = () => {
        if (!element.current?.offsetWidth || !element.current?.offsetHeight) return;
        fit.fit();
        send({ type: 'resize', id, cols: terminal.cols, rows: terminal.rows });
      };
      const observer = new ResizeObserver(resize);
      observer.observe(element.current!);
      const input = terminal.onData((data) => send({ type: 'input', id, data }));
      const unsubscribe = subscribeOutput((event) => {
        if (event.id === id) {
          if (event.reset) terminal.reset();
          terminal.write(event.data);
        }
      });
      resize();
      send({ type: 'subscribe', id });
      dispose = () => {
        unsubscribe();
        input.dispose();
        observer.disconnect();
        terminal.dispose();
        send({ type: 'subscribe', id: null });
      };
    });
    return () => {
      cancelAnimationFrame(frame);
      dispose();
    };
  }, [id, connected, send, subscribeOutput]);
  return <div className="terminal-host" ref={element} aria-label="Terminal interaktif" />;
}
