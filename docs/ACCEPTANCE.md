# Phase 1 — definition of done

Phase 1 ships when every box below is checked. This is the acceptance checklist for the
observability core; it is derived from [`DESIGN.md`](DESIGN.md) §2 (what to build) and §8 (the edge
cases to handle by design). It exists so "done" is falsifiable rather than a judgment call, and so a
fresh session can verify the phase without re-deriving the criteria.

Check items off as the commits that satisfy them land — this file is the durable progress record
across context resets, not only a final gate.

Each item marked **(test)** must be backed by a `node --test` assertion against a captured fixture
(see [Testing](#testing) below) — not by manual inspection, which does not survive a context reset.

## Functional — endpoints and the seam

- [ ] **Source seam** exists as the single read boundary: `listLogs()`, `readTranscript(runId)`,
      `scanWorkdirs()`, `tailDispatcherLog()`, `healthz()`. No consumer reaches `kubectl` directly.
      The backend behind the seam is swappable without touching consumers (DESIGN §2; this is the
      Phase 2 swap surface). Swappability is proven, not asserted: an in-memory backend implementing
      the same five functions backs the test suite, so the Phase 2 swap is exercised from day one.
- [ ] `GET /runs` — live runs (healthz + workdir + log) merged with historical (transcript-file
      scan), each tagged `done | running | incomplete`, carrying role / repo / item / trigger / cost
      / timestamps. **(test)**
- [ ] `GET /runs/:id/transcript` — stream-json normalized into a timeline of
      `thinking / text / tool_use (+ result) / result`. **(test)**
- [ ] `GET /cost` — rollup of `total_cost_usd` from each completed file's final `result`, cached by
      mtime. **(test)**
- [ ] `GET /events` — SSE of parsed dispatcher events (enrichment only, not the liveness clock).
- [ ] Static SPA served by the local server.

## Functional — SPA

- [ ] RUNNING and RECENT lists, each run showing both absolute and relative timestamps.
- [ ] Collapsible transcript view.
- [ ] Cost header.
- [ ] Spawn notifications: server-side `osascript` plus a browser notification and ping.

## Correctness — the §8 edge cases, locked by tests

These are the things that look correct in a demo and silently produce wrong output in real use. Each
must be handled by design and pinned by a fixture test.

- [ ] **Cost is read only from the final `result` event.** Per-message `output_tokens` undercuts the
      authoritative total by ~7–9×, so mid-run cost is unavailable by nature and must not be
      displayed as authoritative. **(test: a fixture whose per-message sum diverges from the final
      total asserts we report the final total.)**
- [ ] **Run-state heuristic:** `result` present = `done`; absent with a fresh mtime = `running`;
      absent and stale = `incomplete`. `healthz.activeRuns` is the authoritative cross-check.
      "No result = running" must not produce phantom runs. **(test: fixtures for each of the three
      states, plus a healthz cross-check case.)**
- [ ] **Transcript pairing:** every `tool_use` is paired with its `tool_result`; payloads truncated
      at ~4 KB. **(test: a fixture with an unpaired tool_use and an oversized payload.)**
- [ ] **Any residual `/proc` scan** uses `grep -m1` (never `grep | head`, which SIGPIPEs under
      `pipefail`) and excludes `$$` (it self-matches on the discriminator). Largely moot once cancel
      is internal; assert it if such a scan exists.

## Non-functional

- [ ] Server binds `127.0.0.1` only — never a routable interface.
- [ ] **`runId` / `:id` is validated** against its expected shape before it reaches a `kubectl`/shell
      argument or a `/data/work/<runId>` path — no shell injection, no path traversal. 127.0.0.1
      binding limits exposure but a localhost SPA plus an attacker-influenced runId is still a vector.
      **(test: a fixture with a malicious id is rejected, not interpolated.)**
- [ ] Liveness polling cadence is ~2–3s (healthz + workdir scan), independent of the buffered
      dispatcher log.
- [ ] **End-to-end detection latency:** a newly spawned run appears in RUNNING and fires its
      notification within ~one poll cycle (~2–3s) of its workdir/healthz becoming visible. This is the
      product's reason for existing — verify it explicitly, by live probe if it isn't unit-testable,
      rather than leaving it implied by the cadence checkbox.
- [ ] Lifecycle script supports `start | stop | status | restart` and reaps its `kubectl` child on
      stop/restart.
- [ ] Zero runtime dependencies: Node + vanilla JS, kubeconfig the only external requirement
      (DESIGN §1 ethos). No code ported from `../mitoscope-poc`.

## Testing

The test corpus is captured real data, not hand-written mocks — the parser's job is to survive the
shapes the cluster actually emits.

- [ ] `test/fixtures/` holds real samples captured during the "probe the cluster" step: at least one
      complete transcript, one incomplete/running transcript, a `healthz` response, a workdir
      listing, and a cost-bearing final `result`.
- [ ] `node --test` runs offline against those fixtures and is green.
- [ ] The seam is **injectable**: an in-memory backend implements `listLogs`, `readTranscript`,
      `scanWorkdirs`, `tailDispatcherLog`, `healthz` from `test/fixtures/`, and the suite runs against
      it. This keeps `node --test` cluster-free and exercises the Phase 2 swap surface.
- [ ] A meta-test walks the seam (`listLogs`, `readTranscript`, `scanWorkdirs`, `tailDispatcherLog`,
      `healthz`) and **fails if any function lacks a corresponding fixture** — so adding a parser
      without a fixture turns the suite red on its own, rather than relying on discipline.
