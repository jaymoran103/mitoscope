'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createSource, SEAM_FUNCTIONS } = require('../src/source');
const { FIXTURE_ROOTS, FIXTURE_DIR } = require('../src/source/memory');
const { isValidRunId } = require('../src/runid');

const DONE_RUN = 'worker-plat-timealign-initial-mqi1ilmpq';

function memory(opts) {
  return createSource({ backend: 'memory', ...opts });
}

test('seam exposes exactly the five documented functions', () => {
  const src = memory();
  assert.deepEqual(Object.keys(src).sort(), [...SEAM_FUNCTIONS].sort());
  for (const fn of SEAM_FUNCTIONS) assert.equal(typeof src[fn], 'function', `${fn} is callable`);
});

test('healthz() returns the liveness shape', async () => {
  const h = await memory().healthz();
  assert.deepEqual(h, { ok: true, activeRuns: 0, queued: 0 });
});

test('listLogs() returns one entry per run with real size + epoch-ms mtime', async () => {
  const logs = await memory().listLogs();
  assert.equal(logs.length, 3);
  const done = logs.find((l) => l.runId === DONE_RUN);
  assert.ok(done, 'captured worker run is listed');
  assert.equal(done.size, 280506, 'real byte size from the cluster');
  // 1781699882.14 s -> ms; far in the past, an integer count of milliseconds.
  assert.equal(done.mtime, 1781699882143);
  assert.equal(Number.isInteger(done.mtime), true);
  for (const l of logs) assert.equal(isValidRunId(l.runId), true, `${l.runId} is a valid id`);
});

test('readTranscript() returns the raw transcript text faithfully', async () => {
  // The seam returns bytes as-is — including the git-clone preamble a worker emits
  // before the stream-json begins (a real shape the timeline parser must skip later).
  // Normalizing/parsing is a consumer's job above the seam, not the seam's.
  const raw = await memory().readTranscript(DONE_RUN);
  const lines = raw.split('\n').filter(Boolean);
  assert.ok(lines.length >= 2, 'multi-line transcript');
  assert.match(lines[0], /^Cloning into/, 'leading non-JSON preamble preserved');
  assert.equal(JSON.parse(lines.at(-1)).type, 'result', 'final stream-json object is the result');
});

test('readTranscript() rejects an injection-shaped runId before any read', async () => {
  for (const bad of ['../state', 'a/../../etc/passwd', 'x; rm -rf /', '$(whoami)', 'a b']) {
    await assert.rejects(() => memory().readTranscript(bad), /invalid runId/, `${bad} rejected`);
  }
});

test('scanWorkdirs() parses the workdir listing (empty while idle)', async () => {
  const dirs = await memory().scanWorkdirs();
  assert.deepEqual(dirs, []);
});

test('tailDispatcherLog() yields the dispatcher log line by line', async () => {
  const tail = memory().tailDispatcherLog();
  const seen = [];
  for await (const line of tail.lines) seen.push(line);
  tail.close();
  assert.ok(seen.length >= 1, 'at least the startup line');
  assert.match(seen[0], /^\S+\s+(info|warn|error|debug)\s/, 'parseable dispatcher line');
});

test('mtimes override pins a run fresh/stale without touching the clock', async () => {
  const logs = await memory({ mtimes: { [DONE_RUN]: 9999 } }).listLogs();
  assert.equal(logs.find((l) => l.runId === DONE_RUN).mtime, 9999);
});

// Meta-test: every seam function must have a backing fixture. Adding a parser/function
// without a fixture turns the suite red on its own, rather than relying on discipline
// (ACCEPTANCE Testing).
test('meta: every seam function has a populated fixture root', () => {
  for (const fn of SEAM_FUNCTIONS) {
    const root = FIXTURE_ROOTS[fn];
    assert.ok(root, `seam function ${fn} declares a fixture root`);
    const dir = path.join(FIXTURE_DIR, root);
    assert.ok(fs.existsSync(dir), `fixture root exists: ${root}`);
    const entries = fs.readdirSync(dir).filter((f) => !f.startsWith('.'));
    assert.ok(entries.length > 0, `fixture root ${root} is populated`);
  }
});
