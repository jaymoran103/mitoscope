'use strict';

// Cost rollup: sum `total_cost_usd` across completed runs, cached by mtime
// (DESIGN §2 `/cost`). Cost is read ONLY from a run's final `result` event: per-message
// `output_tokens` undercount the authoritative total by ~7-9x (DESIGN §8), so mid-run
// cost is unavailable by nature and must never be summed or shown as authoritative. This
// module never looks at per-message usage — only the final result's `total_cost_usd`.

// Return the `total_cost_usd` of a transcript's final `result`, or null if it has none
// (a still-running / killed run, or a terminal error result — its cost is unavailable,
// not zero, and not a stale earlier figure). Keyed on the LAST result line specifically:
// if that terminal result carries no numeric cost, the answer is null even when an
// earlier result did, so a transcript can only ever report its terminal cost.
function finalCost(raw) {
  let last = null;
  for (const line of String(raw).split('\n')) {
    if (!line.includes('"type":"result"')) continue; // cheap prefilter; parse decides
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.type === 'result') last = o;
  }
  return last && typeof last.total_cost_usd === 'number' ? last.total_cost_usd : null;
}

// Build a cost roller over a source (uses listLogs + readTranscript only). Results are
// cached by (runId, mtime): a file whose mtime is unchanged is not re-read or re-parsed.
// A null mtime (malformed listing) is treated as a cache miss every time — correctness
// over the caching optimization; the run-state heuristic commit owns null-mtime policy.
function createCostRoller(source) {
  const cache = new Map(); // runId -> { mtime, cost }

  async function rollup() {
    const logs = await source.listLogs();
    const runs = [];
    let totalCostUsd = 0;
    let counted = 0; // runs contributing a final cost
    let pending = 0; // runs with no final result yet (cost unavailable)

    for (const { runId, mtime } of logs) {
      const hit = cache.get(runId);
      let cost;
      if (hit && mtime != null && hit.mtime === mtime) {
        cost = hit.cost;
      } else {
        cost = finalCost(await source.readTranscript(runId));
        cache.set(runId, { mtime, cost });
      }

      if (cost == null) {
        pending += 1;
        runs.push({ runId, costUsd: null });
      } else {
        totalCostUsd += cost;
        counted += 1;
        runs.push({ runId, costUsd: cost });
      }
    }

    return { totalCostUsd, counted, pending, runs };
  }

  return { rollup };
}

module.exports = { createCostRoller, finalCost };
