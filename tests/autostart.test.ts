import test from 'node:test';
import assert from 'node:assert/strict';
import { getStartupDir, getVbsPath } from '../server/autostart.js';

test('autostart computes startup directory and VBS script path', () => {
  const dir = getStartupDir();
  const vbs = getVbsPath();
  assert.ok(dir.includes('Startup'));
  assert.ok(vbs.endsWith('agent-dock.vbs'));
});
