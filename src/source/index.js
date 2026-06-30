'use strict';

// The data-access seam: the single boundary every consumer reads through, and the
// load-bearing investment that keeps Phase 2 a backend swap rather than a rewrite
// (DESIGN §2; ACCEPTANCE "Source seam"). No consumer reaches `kubectl` directly — they
// depend only on these five functions and the shapes they return.
//
// A source is any object implementing:
//
//   healthz()            -> Promise<{ ok, activeRuns, queued }>
//       In-memory dispatcher truth from GET :9909/healthz. The authoritative liveness
//       signal; unbuffered, so it does not lag like the dispatcher log.
//
//   listLogs()           -> Promise<Array<{ runId, size, mtime }>>
//       One entry per transcript file in /data/logs. `mtime` is epoch ms (the run-state
//       heuristic's freshness clock); `runId` is the filename without `.log`.
//
//   readTranscript(runId) -> Promise<string>
//       Raw stream-json text for one run. Must validate runId before it reaches a shell
//       argument or path (see ../runid).
//
//   scanWorkdirs()       -> Promise<Array<{ runId, mtime }>>
//       Directories under /data/work. A workdir appears the instant a run starts, so
//       this is the fast-detection signal paired with healthz.
//
//   tailDispatcherLog()  -> { lines: AsyncIterable<string>, close(): void }
//       The dispatcher's structured stdout, line by line. Enrichment only
//       (triggers/causality) — never the liveness clock. `close()` stops the tail.
//
// The function names are listed here so the meta-test can walk them and fail when a new
// seam function ships without a backing fixture (ACCEPTANCE Testing).
const SEAM_FUNCTIONS = [
  'healthz',
  'listLogs',
  'readTranscript',
  'scanWorkdirs',
  'tailDispatcherLog',
];

const { createKubectlSource } = require('./kubectl');
const { createMemorySource } = require('./memory');

// Default to the live kubectl backend; tests inject the in-memory one. Selecting a
// backend is the only thing that changes between Phase 1 and Phase 2.
function createSource(opts = {}) {
  const backend = opts.backend || process.env.SOURCE_BACKEND || 'kubectl';
  if (backend === 'memory') return createMemorySource(opts);
  if (backend === 'kubectl') return createKubectlSource(opts);
  throw new Error(`unknown source backend: ${backend}`);
}

module.exports = { createSource, createKubectlSource, createMemorySource, SEAM_FUNCTIONS };
