'use strict';

// Parsers for the raw `find` output the kubectl backend collects from the pod. They
// live apart from the backend so they can be exercised offline against captured
// fixtures (the in-memory backend feeds them the same bytes the cluster emits).

// `find -printf '%T@\n'` prints mtime as fractional epoch seconds; the seam reports
// epoch milliseconds.
function epochToMs(token) {
  const secs = parseFloat(token);
  return Number.isFinite(secs) ? Math.round(secs * 1000) : null;
}

// Parse `find <logdir> -printf '%f\t%s\t%T@\n'` -> [{ runId, size, mtime }].
// Each line is `<name>.log\t<bytes>\t<epoch>`.
function parseLogList(raw) {
  const out = [];
  for (const line of String(raw).split('\n')) {
    if (!line) continue;
    const [name, size, epoch] = line.split('\t');
    if (!name || !name.endsWith('.log')) continue;
    out.push({
      runId: name.slice(0, -'.log'.length),
      size: Number.parseInt(size, 10) || 0,
      mtime: epochToMs(epoch),
    });
  }
  return out;
}

// Parse `find <workdir> -maxdepth 1 -mindepth 1 -printf '%f %T@\n'` -> [{ runId, mtime }].
// Each line is `<runId> <epoch>`; the runId (a directory name) never contains a space,
// so split on the final space.
function parseWorkdirs(raw) {
  const out = [];
  for (const line of String(raw).split('\n')) {
    if (!line) continue;
    const i = line.lastIndexOf(' ');
    if (i < 0) continue;
    out.push({ runId: line.slice(0, i), mtime: epochToMs(line.slice(i + 1)) });
  }
  return out;
}

module.exports = { parseLogList, parseWorkdirs, epochToMs };
