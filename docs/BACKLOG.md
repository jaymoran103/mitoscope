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
