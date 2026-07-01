# Backlog — emergent concerns

Open implementation concerns observed while building: bugs, fragilities, missing edge cases,
"this will bite us later" friction. Capture-and-continue — logging here must never derail the
work in progress.

This is the *emergent* stream only. It is **not** for vetted design deferrals (those live in
[`notes/operator-control-learnings.md`](notes/operator-control-learnings.md)
`§ Deferred / future additions`) or current-phase definition-of-done
([`ACCEPTANCE.md`](ACCEPTANCE.md)). Rationale, the boundary model, and triage routing:
[`specs/2026-06-30-backlog-triage-design.md`](specs/2026-06-30-backlog-triage-design.md).

`/triage` reviews this file against the roadmap ([`DESIGN.md §7`](DESIGN.md)) and proposes what
to take next; `/backlog` captures. Resolved entries are removed when the fix lands — git holds
history, and the "why" lives in the commit or the satisfied ACCEPTANCE check.

## Entry template

Copy this block for a new concern (or invoke `/backlog`, which fills it in and dedups):

```
### <one-line symptom>
- **Where:** <file:line / area / phase>
- **Context:** <why it matters, why deferred, what will bite later>
- **Surfaces / blocks:** <what makes it urgent, or which work it blocks; optional severity>
- **Captured:** <YYYY-MM-DD · short-commit · phase>
```

## Open concerns

### tailDispatcherLog() crashes the process on kubectl spawn failure
- **Where:** src/source/kubectl.js:68 (`tailDispatcherLog`); contrast `run()` at :34.
- **Context:** The spawned `kubectl logs -f` child has no `'error'` listener, unlike the child in
  `run()` (which attaches `child.on('error', reject)`). If `kubectl` is missing from PATH or the
  spawn otherwise fails, Node emits an unhandled `'error'` event and the whole mitoscope process
  dies. Reproduced during the review pass: spawning a nonexistent binary with no handler → uncaught
  ENOENT → process exit. Deferred because this was a review pass over the staged seam, not an
  implementation session; the live kubectl backend is unit-untested by design (DESIGN §2), so no
  fixture covers it. Fix is ~3 lines: attach an `'error'` handler that closes the readline interface
  and surfaces the failure the way `run()` already does.
- **Surfaces / blocks:** Crash-class, but unreachable until a consumer wires up `tailDispatcherLog()`
  (no consumer exists in Phase 1). Resolve before/with the first consumer of the dispatcher tail.
  Severity: high once reachable.
- **Captured:** 2026-06-30 · e90887a · Phase 1

### healthz() throws instead of reporting not-ok when the dispatcher is down
- **Where:** src/source/kubectl.js:47-50 (`healthz`).
- **Context:** `curl -s` swallows connection errors and exits 0 with an empty body, so
  `JSON.parse('')` throws and `healthz()` rejects. DESIGN calls healthz "the authoritative liveness
  signal"; a down dispatcher arguably should resolve `{ ok: false, ... }` rather than throw, so a
  poller can render "down" instead of erroring out. This is a design call, not a clear-cut bug —
  logged so it's decided deliberately rather than inherited by accident. Deferred to when a consumer
  actually polls healthz for liveness.
- **Surfaces / blocks:** Decide before the consumer that polls healthz. Severity: medium; affects
  liveness UX, no crash.
- **Captured:** 2026-06-30 · e90887a · Phase 1

### Malformed `find` line yields mtime: null, which the run-state clock consumes
- **Where:** src/source/parse.js:24,40 (`parseLogList`, `parseWorkdirs` via `epochToMs`).
- **Context:** A truncated or garbled `find` output line produces `{ size: 0, mtime: null }`
  (`parseInt`→NaN→0; `epochToMs`→null). The run-state freshness heuristic consumes `mtime` as a
  clock, and `null` in time arithmetic yields NaN/0 — a run could be misclassified fresh/stale. Not
  reachable from current fixtures (real `find` output is well-formed), so deferred. The run-state
  heuristic commit should decide whether to skip or floor a null mtime.
- **Surfaces / blocks:** Blocks correctness of the run-state heuristic commit (handle it there).
  Severity: low / latent.
- **Captured:** 2026-06-30 · e90887a · Phase 1

### parseTranscript maxPayload: 0 silently becomes 4096 (falsy-zero footgun)
- **Where:** src/transcript.js (`parseTranscript`, `const maxPayload = opts.maxPayload || DEFAULT_MAX_PAYLOAD`).
- **Context:** `||` treats `0` as absent, so a caller passing `maxPayload: 0` to mean "truncate
  everything" silently gets the 4096 default instead. No current caller passes 0 (the parser is
  called with defaults), so it's latent — logged so the next caller that wants a custom cap doesn't
  hit a surprising floor. Fix is one char: `opts.maxPayload ?? DEFAULT_MAX_PAYLOAD`.
- **Surfaces / blocks:** Not reachable until a consumer passes an explicit `maxPayload`. Severity:
  low / trivial.
- **Captured:** 2026-06-30 · 909dbc4 · Phase 1

### truncate() output exceeds maxBytes by the truncation marker length (soft cap)
- **Where:** src/transcript.js (`truncate`); test asserts against `DEFAULT_MAX_PAYLOAD + 64` in test/transcript.test.js.
- **Context:** The appended `…[truncated N more bytes]` marker is added *after* the cap, and its
  length grows with N, so a truncated payload always exceeds `maxBytes` by ~20–30 bytes. The test
  acknowledges this by bounding against `DEFAULT_MAX_PAYLOAD + 64` rather than the cap itself. Fine
  while the cap is advisory (keep one giant payload from bloating the timeline), but if a hard byte
  ceiling ever matters (e.g. a downstream buffer/quota), the marker room must be reserved *inside*
  `maxBytes`. Logged so the soft-vs-hard distinction is a decision, not an accident.
- **Surfaces / blocks:** No current consumer needs a hard cap. Severity: low / latent.
- **Captured:** 2026-06-30 · 909dbc4 · Phase 1

### Cost prefilter assumes compact JSON; a spaced result line is dropped, undercounting the total
- **Where:** src/cost.js (`finalCost`, the `line.includes('"type":"result"')` prefilter).
- **Context:** The cheap prefilter only matches compact `"type":"result"`. A pretty-printed/spaced
  result line (`"type": "result"`) fails it, so `finalCost` returns null, the run is counted
  `pending`, and its cost silently drops from `/cost` — a silent undercount, worse than a crash.
  `src/transcript.js` parses every line without this prefilter, so cost.js is strictly more fragile
  than its sibling for no functional gain. Not reachable from current fixtures (the cluster emits
  compact stream-json — all three fixture costs compute correctly). Fix: drop the prefilter, or gate
  on a whitespace-tolerant check. Surfaced by the commit-3 review.
- **Surfaces / blocks:** Latent until non-compact transcripts appear. Severity: low / robustness.
- **Captured:** 2026-06-30 · 1198c52 · Phase 1

### /cost total carries float noise (2.1893222000000003) with no rounding boundary
- **Where:** src/cost.js (`rollup` — `totalCostUsd` accumulation/return).
- **Context:** `total_cost_usd` values are summed as JS doubles and returned unrounded; the corpus
  already yields `2.1893222000000003`. The rollup test's `1e-9` tolerance masks this. Arguably
  correct for a rollup to return full precision, but the `/cost` endpoint / SPA cost-header will
  serialize it verbatim unless someone rounds. Decide where rounding lives (endpoint/formatting
  layer) so the noisy number never reaches the UI. Surfaced by the commit-3 review.
- **Surfaces / blocks:** Blocks the /cost endpoint / SPA cost-header commit — own the rounding there.
  Severity: low / cosmetic.
- **Captured:** 2026-06-30 · 1198c52 · Phase 1

### Cost cache grows unbounded — entries for deleted runs are never evicted
- **Where:** src/cost.js (`rollup` — `cache` Map; entries set, never deleted).
- **Context:** `rollup` adds a cache entry per runId and never removes entries for runs that vanish
  from `listLogs` (rotated/deleted logs). No correctness impact — rollup iterates only current logs,
  and runIds are unique-suffixed so there is no reuse/staleness risk — but the Map grows for the
  process lifetime. Fix: prune keys not present in the current `listLogs` pass. Surfaced by the
  commit-3 review.
- **Surfaces / blocks:** Latent; a long-running server accumulates dead entries. Severity: low / latent.
- **Captured:** 2026-06-30 · 1198c52 · Phase 1
