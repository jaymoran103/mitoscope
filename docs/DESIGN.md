# mitoscope — design & build brief

What to build, and in what order. This is the implementation brief; the reasoning behind each
decision lives in [`notes/operator-control-learnings.md`](notes/operator-control-learnings.md), where
each decision is recorded as `Cluster N · DM`. The references below (e.g. *Cluster 2·D2*) point there.
The earlier proof-of-concept is kept for reference at [`../mitoscope-poc`](../mitoscope-poc); none of
its code is carried over (this is a clean rebuild).

Target system: a self-hosted AI-agent platform (the `mitosis` k3d crew — a dispatcher plus Claude
subprocesses in namespace `agents`, context `k3d-plat`). mitoscope observes it read-only and,
optionally, moderates it.

---

## 1. Architecture: a read/write split

```
                observability core (always)            control module (opt-in)
browser SPA ──> local server (127.0.0.1) ──kubectl──> k3d cluster
                     │  read-only: logs, /data reads,        │  honor agent-hold label (gate)
                     │  healthz, workdir scans               │  POST /cancel (kill + park)
                     └── control module mounts here ─────────┘  GET /control/capabilities
```

The observability core is standalone: it makes no assumptions about the dispatcher's version, needs
only a kubeconfig, and ships and runs on its own. It contains no mutating code.

Control is a self-contained module the core does not depend on. With it absent, the tool is genuinely
read-only. With it present and enabled (`CONTROL=1`) and the handshake passing, it mounts its `cancel`
call and adds stop/hold/release controls to the same dashboard. **The split is a module boundary, not
a runtime flag**, so the read-only build ships without any control code. *(Cluster 3·D4.)*

---

## 2. Observability core (Phase 1)

Acquisition model: liveness and data come from in-memory truth and direct reads, never from the
buffered dispatcher log (which lags by minutes — the dispatcher's Bun stdout is block-buffered to a
pipe).

- Liveness comes from `GET :9909/healthz` (`{activeRuns, queued}`, unbuffered) plus a scan of
  `/data/work/<runId>` (the workdir appears the instant a run starts), polled every ~2–3s.
- The dispatcher log stream supplies triggers and causality only; it is enrichment, not the liveness
  clock.
- Every read goes through a small source abstraction — `listLogs()`, `readTranscript(runId)`,
  `scanWorkdirs()`, `tailDispatcherLog()`, `healthz()`. The backend behind it is swappable with no
  change to consumers. **This seam is the load-bearing foundation investment**; it is what keeps Phase
  2 a swap rather than a rewrite. *(Cluster 4·D1/D2.)*

Endpoints (local server):

- `GET /runs` — live (healthz + workdir + log) merged with historical (transcript-file scan); each run
  tagged `done | running | incomplete` (see §8), with role/repo/item/trigger/cost/timestamps.
- `GET /runs/:id/transcript` — stream-json normalized into a timeline (thinking / text / tool_use +
  result / result).
- `GET /cost` — rollup of `total_cost_usd` from each completed file's final `result`, cached by mtime.
- `GET /events` — SSE of parsed dispatcher events (enrichment).
- Static SPA.

SPA: RUNNING / RECENT lists with timestamps (absolute and relative), a collapsible transcript view, a
cost header, and spawn notifications (server-side `osascript` plus a browser notification and ping) —
the payoff of fast detection.

Hardening: a lifecycle script (`start|stop|status|restart`, which reaps its kubectl child); bind to
`127.0.0.1`.

---

## 3. Decoupled data backend (Phase 2)

Implement the seam against a source independent of the agents-pod lifecycle, so history survives
`scale --replicas=0`. Only data at rest (transcripts, cost, `state.json`) needs this; live signals
(`healthz`, workdirs) are meaningless at replicas=0 and stay tied to the agents pod.

- Preferred: a local mirror — periodically `kubectl cp`/rsync `/data` to local disk. Keeps the
  nothing-in-cluster footprint; eventually-consistent.
- Alternative: a reader pod mounting the `agents-data` PVC (`RWO local-path`, single-node k3d, so
  shareable). Always current, but it deploys something in-cluster.

Choose at build time. **Sequencing rule: the replicas-toggle control feature depends on this phase —
never ship the toggle before Phase 2, or it blinds the tool.** *(Cluster 4·D2.)*

---

## 4. Control: suppression and cancellation

Two distinct jobs:

- Suppression (don't spawn or respawn) is driven by an `agent-hold` Forgejo label, read by a single
  dispatcher gate at every spawn chokepoint (`maybeWork`, `maybeReview` before the reviewed-sha check,
  the sweep, `maybeBootstrap`). The label is usable from the Forgejo UI and covers all roles including
  the reviewer, so the reviewer no longer needs special handling. *(Cluster 1·D1; reviewer: 2·D1.)*
- Live termination is a dispatcher `cancel` that kills the running process (it owns the handle) and
  parks the affected items by applying `agent-hold` to the issue and its PR. *(Cluster 2·D2.)*

Lifecycle semantics:

- Granularity is per-item (label on an issue or PR). A whole-crew pause is the separate replicas
  toggle. Per-repo holds are deferred. *(Cluster 1·D2.)*
- Reversibility: release is removing the label. Resume is passive — the existing sweep / un-label
  webhook re-evaluates and a fresh run continues from the durable Forgejo and git artifacts. It is
  lossless for committed work (statelessness guarantees it); only uncommitted edits in a
  separately-killed run's ephemeral workdir are lost. Holds are sticky until removed (no auto-expiry).
  *(Cluster 1·D3.)*
- Audit and idempotency: hold and release are self-documenting via the label and Forgejo's timeline
  (no comment). A cancel posts one comment naming the killed run, the actor, what was parked, and how to
  resume. All actions also land in the dispatcher's structured log. Add/remove-label and kill-if-alive
  are no-ops when already in the target state. *(Cluster 2·D3.)*

---

## 5. The control contract (`docs/CONTROL-CONTRACT.md`, formalized in Phase 3)

Minimal, defined by mitoscope, semver'd independently; the dispatcher implements it *(Cluster 3·D1)*:

1. A passive convention — honor the `agent-hold` label at every spawn chokepoint. No endpoint; the
   label is applied and removed via plain Forgejo (mitoscope's label calls and the human UI).
2. `POST /cancel` — kill the live process and park the items. The only operation that needs the process
   handle.
3. `GET /control/capabilities` → `{contractVersion, verbs[]}` — the handshake. The client validates this
   payload against the set of verbs it expects, so conformance is checked at runtime rather than trusted
   from prose. *(Cluster 3·D2.)*

Transport and auth: reached via `kubectl exec … curl localhost:9909/…`; the dispatcher's control
endpoints bind localhost-in-pod (exec-only, never network-exposed); authorization is cluster
access/RBAC, with no new auth scheme. A port-forward + bearer-token transport is a documented future
option (triggers are listed in the notes' deferred section). *(Cluster 3·D3.)*

Mismatch behavior: if the endpoint is absent/unreachable or the major version differs, control stays
off, observability is unaffected, and a banner explains why; if the dispatcher is a minor version
behind, only the supported features light up.

---

## 6. Cross-repo model

Two repos, one versioned interface *(Cluster 4·D3)*:

- The contract spec is the source of truth in mitoscope (`docs/CONTROL-CONTRACT.md`), semver'd
  independently.
- The dispatcher implementation is documented in `agents/CONTROL.md`, declaring the version it
  implements.
- A compatibility matrix (`mitoscope-control vX ↔ agents vY ↔ contract vZ`) and a "required patches /
  minimum version" index live in mitoscope, updated per release. The handshake is the runtime guard;
  the matrix is the human record.
- Semver: additive changes are minor (the label stays the source of truth); breaking changes are major
  (the internal-state pivot).

---

## 7. Phased roadmap

Small, reviewable commits within each phase. Observability (Phase 1, optionally with Phase 2) is a
complete deliverable before any control work begins. Phases 3 and 4 can overlap, since the handshake
lets the module ship dark until the contract is deployed. *(Cluster 4·D2.)*

| Phase | Deliverable | Repo |
|---|---|---|
| 0 | Scaffold (README, docs, `.gitignore`) | mitoscope |
| 1 | Observability core: seam, healthz/workdir liveness, `/runs`, transcript parser, cost rollup, SPA + timestamps, notifications, lifecycle script + 127.0.0.1 | mitoscope |
| 2 | Decoupled data backend (local-mirror preferred) — history survives scale-to-0 | mitoscope |
| 3 | Control contract: `agent-hold` gate, `cancel`, `/control/capabilities`, `agents/CONTROL.md`, versioned image | agents |
| 4 | Control module (opt-in): handshake + degrade, hold/release (label) + cancel (exec), UI injection + banner, compatibility matrix | mitoscope |

---

## 8. Edge cases to handle by design (found during the POC)

- **Per-message `output_tokens` in stream-json undercuts the authoritative total by roughly 7–9×**, so
  cost is only trustworthy from the final `result` event. Mid-run cost is unavailable by nature.
- **Run-state heuristic**: result present = done; absent with a fresh mtime = running; absent and stale
  = incomplete. "No result = running" produces phantom runs. (`healthz.activeRuns` is now the
  authoritative cross-check.)
- Transcript timeline: pair `tool_use` with its `tool_result`, and truncate payloads at ~4 KB.
- Any residual `/proc` scan: use `grep -m1` (not `grep | head`, which SIGPIPEs under `pipefail`) and
  exclude `$$` (it self-matches on the discriminator). Largely moot once cancel is internal.

---

## 9. Pointers

- Rationale and decision journal: [`notes/operator-control-learnings.md`](notes/operator-control-learnings.md),
  including the deferred-additions list and their triggers.
- Cost/usage estimation (why we reuse ccusage rather than build):
  [`notes/usage-estimate-takeaways.md`](notes/usage-estimate-takeaways.md).
- POC reference (including the external-kill writeup): `../mitoscope-poc/` (`AGENT-KILL.md`, `server.js`).
