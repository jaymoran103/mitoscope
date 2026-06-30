'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { assertRunId } = require('../runid');
const { parseLogList, parseWorkdirs } = require('./parse');

// In-memory backend: implements the seam against captured fixtures instead of a live
// cluster. It is what keeps `node --test` offline AND proves the Phase 2 swap works —
// the test suite drives the real consumers through this backend, so a backend that
// satisfies the seam is demonstrably interchangeable with kubectl (DESIGN §2;
// ACCEPTANCE "injectable").

const FIXTURE_DIR = path.join(__dirname, '..', '..', 'test', 'fixtures');

// Which fixture subtree backs each seam read. The meta-test asserts every entry exists
// and is populated, so adding a seam function without a fixture turns the suite red on
// its own (ACCEPTANCE Testing).
const FIXTURE_ROOTS = {
  healthz: 'healthz',
  listLogs: 'logs',
  readTranscript: 'logs',
  scanWorkdirs: 'workdirs',
  tailDispatcherLog: 'dispatcher',
};

// opts:
//   dir            - fixture root (default test/fixtures)
//   healthzFile    - which healthz/*.json to serve   (default idle.json)
//   workdirsFile   - which workdirs/*.txt to serve    (default empty.txt)
//   dispatcherFile - which dispatcher/*.log to serve  (default startup.log)
//   mtimes         - { runId: epochMs } overrides, so a test can pin a run "fresh" or
//                    "stale" for the run-state heuristic without touching the clock.
function createMemorySource(opts = {}) {
  const dir = opts.dir || FIXTURE_DIR;
  const healthzFile = opts.healthzFile || 'idle.json';
  const workdirsFile = opts.workdirsFile || 'empty.txt';
  const dispatcherFile = opts.dispatcherFile || 'startup.log';
  const mtimes = opts.mtimes || {};

  const logsDir = path.join(dir, 'logs');
  const read = (...p) => fs.readFileSync(path.join(dir, ...p), 'utf8');
  const withMtime = (entry) => (entry.runId in mtimes ? { ...entry, mtime: mtimes[entry.runId] } : entry);

  async function healthz() {
    const j = JSON.parse(read('healthz', healthzFile));
    return { ok: !!j.ok, activeRuns: j.activeRuns | 0, queued: j.queued | 0 };
  }

  // Serve the listing from the captured `find` output (real cluster sizes + mtimes),
  // exercising the same parser the kubectl backend uses on live data.
  async function listLogs() {
    return parseLogList(read('logs', 'listing.txt')).map(withMtime);
  }

  async function readTranscript(runId) {
    assertRunId(runId);
    return fs.readFileSync(path.join(logsDir, `${runId}.log`), 'utf8');
  }

  async function scanWorkdirs() {
    return parseWorkdirs(read('workdirs', workdirsFile)).map(withMtime);
  }

  function tailDispatcherLog() {
    const all = read('dispatcher', dispatcherFile).split('\n').filter((l) => l.length > 0);
    async function* lines() {
      for (const line of all) yield line;
    }
    return { lines: lines(), close() {} };
  }

  return { healthz, listLogs, readTranscript, scanWorkdirs, tailDispatcherLog };
}

module.exports = { createMemorySource, FIXTURE_ROOTS, FIXTURE_DIR };
