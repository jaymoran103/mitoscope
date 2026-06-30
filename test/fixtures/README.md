# test fixtures — the captured corpus

Real data captured from the live cluster (context `k3d-plat`, namespace `agents`) during
the Phase 1 "probe the cluster" step, plus a few reconstructed shapes the idle cluster
could not emit this session. These are the test corpus, not throwaway knowledge: the
in-memory backend (`src/source/memory.js`) serves the seam from these files so
`node --test` runs offline and exercises the Phase 2 swap (CLAUDE.md test gate).

## Provenance

| path | real? | what it is |
|---|---|---|
| `logs/worker-plat-timealign-initial-mqi1ilmpq.log` | real | Complete worker run, `is_error:false`, `total_cost_usd` 1.97, 36 paired tool_use/tool_result. The "done" + cost-rollup fixture. |
| `logs/reviewer-plat-timealign-initial-mqjsc32i2.log` | real | Complete reviewer run: thinking + text + 8 paired tools, cost 0.22. Backs the transcript timeline; its per-message `output_tokens` sum (135) diverges 7.1x from the final total (956) — the §8 cost edge case. |
| `logs/reviewer-plat-timealign-initial-mqiv73zz2.log` | real | 4-line rate-limited run: `result` present, cost 0, `is_error:true`. Short/errored edge. |
| `logs/listing.txt` | real | `find /data/logs -printf '%f\t%s\t%T@\n'` for the three runs above — real sizes + mtimes. Drives `listLogs()` deterministically. |
| `healthz/idle.json` | real | `GET :9909/healthz` while idle: `{"ok":true,"activeRuns":0,"queued":0}`. |
| `workdirs/empty.txt` | real | `find /data/work …` while idle — empty (no active runs). |
| `dispatcher/startup.log` | real | The dispatcher's stdout after the Jun 30 pod restart (startup lines only). |
| `state.json` | real | `/data/state.json` — dispatcher idempotency state. Reference for later phases. |

## Why some shapes are reconstructed, not captured

At capture time the crew was **idle and rate-limited** (recent runs hit HTTP 429
"session limit"; `activeRuns:0`, `/data/work` empty, the dispatcher log reset to startup
lines by the pod restart). So a populated workdir, a `healthz` with `activeRuns>0`, and
dispatcher run-lifecycle lines could not be captured live this session. Where a later
commit needs those, it adds a fixture reconstructed from the documented format and labels
it as such here, and the end-to-end detection-latency check (ACCEPTANCE non-functional)
is verified by live probe when the crew is next active rather than from a fixture.

## runId shape

`<role>-<owner>-<repo>-<shortid>`, e.g. `reviewer-plat-timealign-initial-mqjsc32i2`:
role ∈ {builder, worker, reviewer}, owner `plat`, repo `timealign-initial` (contains a
dash), shortid `mqjsc32i2`. It is both the transcript filename and the workdir name.
