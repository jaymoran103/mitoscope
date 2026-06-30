# Usage / cost estimation — takeaways

Research notes for anyone considering building cost-tracking, 5-hour-window, or live
token-projection features into mitoscope. **TL;DR: don't rebuild the cost/projection math —
it exists and is better elsewhere. Spend effort on the fleet-attribution + live-health parts
that nothing else does.**

Verified against the live `k3d-plat` cluster (timealign-initial runs). Dates are illustrative;
re-pull numbers before quoting them.

---

## The one hard fact that shapes everything

**Accurate per-run cost is end-of-run only.** Cost lives in the final `result` event
(`total_cost_usd` + full `usage`). You cannot reconstruct it mid-run from the stream:

- Every `assistant` event *does* carry `message.usage`, BUT its `output_tokens` **undercounts
  the authoritative total by ~7–9×** (most output — compaction, internal iterations, sub-calls —
  never surfaces as a top-level assistant event):

  | run | summed from assistant events | actual (result event) |
  |---|---|---|
  | worker mqjrlvw11 | 2,619 out | **23,913 out** |
  | reviewer mqjsc32i2 | 135 out | **956 out** |

- This is NOT fixable by better parsing — it's how the dispatcher's `--output-format stream-json`
  capture behaves. (Standard local `~/.claude` session JSONL may differ; tools like ccusage sum
  per-message usage and are accurate *there*, which is a reason naive reuse on mitosis logs can
  mis-estimate — see below.)

So: **live = activity/velocity/health (always available). historical = cost & 5h-window
(accurate, but only once runs finish).** Design around that split; don't fight it.

---

## What ALREADY exists and is better — do NOT rebuild

The cost / 5-hour-window / burn-rate / projection / cap-detection problem is mature, free, OSS:

- **ccusage `blocks`** — groups usage into Claude's 5-hour billing windows; burn rate, time
  remaining, cost projection, quota warnings. `-t max` uses your highest prior block as the cap
  (== the "self-calibrate the limit from observed ceilings" idea — already shipped). Supports a
  custom data directory. **Caveat:** the `blocks --live` real-time monitor was *removed* in
  v18.0.0; the static report remains.
- **Claude Code Usage Monitor / par-cc-usage** — where the live real-time + plan-limit detection
  + burn prediction migrated to.
- **ccflare / claude-view** — browser dashboards over the same JSONL.
- **ccstat (Rust), claude-statusline** — reimplementations / statusline variants.

Refs:
- https://github.com/ryoppippi/ccusage/blob/main/docs/guide/blocks-reports.md
- https://ccusage.com/guide/live-monitoring (removed-in-v18 note)
- https://claudefa.st/blog/tools/monitors/claude-code-usage-monitor
- https://pypi.org/project/par-cc-usage/

**Building a 5h-window/projection/cap feature from scratch = reinventing this, worse. Avoid.**

### The catch that decides reuse vs. shim

Every one of these assumes **one user's local `~/.claude` session files**. Mitosis agents run
**in-cluster**, writing `/data/logs/{runId}.log` — flat naming, dispatcher-captured stream-json,
a *multi-agent fleet* not one interactive session. "Custom directory" support means *a different
`~/.claude` path*, not an arbitrary flat-file layout. So reuse likely needs: (a) syncing pod logs
to a local dir, and (b) a format/naming shim. Plus the per-message undercount above can throw off
any tool that sums usage instead of reading the `result` event.

---

## What's actually UNIQUE to mitoscope (where effort pays off)

None of those tools know about an orchestrated agent fleet. Mitoscope's real value was never the
cost math — it's **correlation/attribution + live operational awareness**:

- Attribute usage to **role / repo / item / trigger** (worker vs reviewer vs builder; which PR;
  what kicked it off).
- **Per-item lineage** — group runs into the issue → worker → PR → reviewer(s) → verdict → merge
  thread, with loop/retry counts (`validatorRounds`, `retried`, `builderResumes` from
  `/data/state.json`).
- **Live fleet health** — see below.

---

## Live metrics that ARE available (build these instead of projection)

All cheap, all real-time, none need token math:

- **`GET :9909/healthz` → `{activeRuns, queued}`** — authoritative current fleet load. The #1
  "do I need to abort anything?" signal. (Verified live.)
- **Per-run velocity** from the growing transcript: turns-so-far, tool-calls-so-far,
  **current/last tool** ("what is it doing right now"), elapsed.
- **mtime staleness = hang detector** — marked running but the file hasn't grown in N minutes →
  stuck, abort candidate. Highest-value "should I intervene" signal.
- **`rate_limit_event` lines appearing** — you're being throttled *now*. (Also: record cumulative
  window usage at these moments → empirical cap line.)
- Directional only: accumulating input/cache tokens hint at "context load" — never show as cost.

---

## IF you still want the projection graph (only after the experiment below)

The data supports it, but be honest about which line you draw. Turn count predicts **output
tokens** tightly (stable output/turn within a role) but predicts **cost** loosely (cache-reads
balloon with context, high variance):

| role | avg turns | output/turn | cost/turn | cost spread |
|---|---|---|---|---|
| worker | 20 | ~461 | $0.054 | **$0–7.04** |
| reviewer | 34 | ~199 | $0.020 | $0–1.34 |
| builder | 43 | ~529 | $0.066 | (n=1) |

Design (x = elapsed in rolling 5h window, y = cumulative usage; unit toggle output/total/cost):
1. **Solid line = measured** — cumulative usage from runs that *finished* in the window, stepping
   up at each `finishedAt`. Authoritative.
2. **Dashed band = in-flight estimate** — solid tip + Σ `role_avg × (1 − current_turns/role_median_turns)`,
   drawn as a band (role min–max), basis labeled (`worker · 12/~20 turns · ~40% left`).
3. **Dotted = forward burn projection** to window end at recent rate → "will I hit the cap before
   reset?"
- **Self-correcting:** when a run's `result` lands, the true value replaces its estimate and the
  solid line absorbs it — the dashed projection collapses into the solid line as runs finish.
- **Cap** is the genuinely hard part (subscription 5h limits aren't published, vary by plan):
  config constant + self-calibrate from `rate_limit_event` ceilings. (ccusage's `-t max` already
  does this — another reason to reuse.)

---

## Recommended decision path

1. **Don't build cost/projection/cap from scratch.**
2. **Run the 15-min experiment first:** `kubectl cp` a handful of `/data/logs/*.log` into a
   `~/.claude/projects/`-shaped temp dir, point `npx ccusage blocks` (and/or claude-monitor) at it,
   compare its numbers to mitoscope's `result`-event totals (`/cost`).
   - **Parses + matches** → reuse: periodically sync the logs, run ccusage/claude-monitor for the
     cost/5h view, have mitoscope link to it.
   - **Chokes on format / undercounts** → borrow ccusage's block algorithm (OSS) rather than
     inventing one.
3. **Spend mitoscope's own budget on the untrod trail:** fleet attribution (role/repo/item/
   trigger), per-item lineage, and live health (healthz load + velocity + stall detection). Those
   are what no existing tool does.

## Time sinks to avoid (explicit)

- Building a 5h-window / burn-rate / projection / cap-detection engine from scratch — solved by
  ccusage/claude-monitor.
- Trying to compute accurate **mid-run cost** from the stream — impossible (output undercounts
  ~7–9×); cost is end-of-run by nature.
- Treating any per-message-usage sum as authoritative on mitosis logs — it isn't; use the `result`
  event.
- A precise (non-banded) projection line — cost variance is too high per-run; show a band, and
  remember aggregate-over-window error is smaller than per-run error.
