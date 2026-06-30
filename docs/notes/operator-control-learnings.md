# Operator control / agent moderation — learnings & direction

Reference notes from the mitoscope POC, written for handoff to a cleaner greenfield
implementation. Captures **why** moderating the mitosis crew is hard, **what we tried** and how
it fell short, and the **agreed direction** for a cleaner solution. The detailed design is a separate doc (to be written
after review). Sibling notes: cost/usage in [usage-estimate-takeaways.md](usage-estimate-takeaways.md);
the current kill POC in [AGENT-KILL.md](AGENT-KILL.md).

File:line references are to the `~/Desktop/agents` dispatcher repo as of this session — re-verify
before relying on them.

---

## The problem

The recurring need is **moderation, not observation**: swatting down unwanted or problematic
agent runs from an overeager dispatcher — e.g. the CI-failure funnel auto-labelling a PR and
spawning a worker you didn't ask for, or a manual PR edit tripping a review.

The dispatcher is a **purely reactive state machine** over Forgejo state plus a ~60s sweep. It
re-derives all work from observable state and has **no concept of operator intent**. That single
gap is the root of every problem below: controlling it from outside means manipulating the same
state it reads, and it **cannot tell a deliberate operator action from organic state** — so
external control triggers reactions and leaves loose ends.

### Dispatcher facts that constrain any solution (verified)

These were established by **reading the dispatcher source first** (file:line references throughout),
then confirmed live where the POC exercised them — understanding before intervention, not inferred
from poking the running system.

- **Stateless per-item agent loops; no master plan.** Source of truth = Forgejo state + sweep;
  idempotency via `/data/state.json`. Runs are fire-and-forget; the dispatcher does not supervise
  a spawned `claude` child and exposes **no cancel API**.
- **Roles:** `builder` (once/repo, Opus, scaffolds v1 on prime/PR#1), `worker` (Sonnet,
  `agent-work` label → implements a PR), `reviewer` (Sonnet, validates PRs). Priority
  builder>worker>reviewer; `maxConcurrent=2`. `runId = role-owner-repo-shortid`; **no cross-run
  parent linkage**.
- **`🏗️` title prefix = "an agent owns this, not ready for validation."** Dropping it = "ready,
  review me." (`dispatcher.ts:269-271`)
- **Worker is label-gated** (`agent-work`). **Reviewer is label-AGNOSTIC**: any open PR with no
  `🏗️` prefix and an unreviewed head sha is reviewed (sweep `dispatcher.ts:2259`; skip-gate
  `dispatcher.ts:1312` → `reviewed[key] === pr.headSha`). The `reviewed` marker is **in-memory
  state the dispatcher persists** — not externally writable (an exec'd `state.json` edit is
  clobbered by the next save and never reaches memory).
- **No per-PR hold/draft/skip mechanism exists** — only repo-level `skipRepo` (platform plumbing
  + `_`-templates). There is no "leave this one alone" signal for humans or tools.
- The only realtime control-relevant surface is `GET :9909/healthz → {activeRuns, queued}`.

---

## What we tried, and the complications

Each write path below was a **deliberate probe**, run to answer one question empirically: *can
external control be made complete?* The complications and live-test failures are the answer — the
evidence behind the agreed direction, recorded as findings rather than papered over.

### 1. Observation (mitoscope core) — works, keep as-is
External, kubeconfig-only, **read-only** sidecar over `kubectl` (dispatcher log SSE, transcripts,
cost rollup). No coupling, droppable. **No complications** — this is the right boundary for
observation and should stay external.

### 2. Kill / cancel a run — the first write path (POC), external by design
100% external via `kubectl exec` + the pod's own creds. Resolve PR→live `claude` child PID by
scanning `/proc` (discriminator: `--append-system-prompt-file`), refuse on ambiguity, **strip
`agent-work`/`agent-working` BEFORE killing** (else the recovery sweep respawns it), then comment
with the resolution trace. Gated behind `CONTROL=1`.

> **Known POC risk (not yet addressed):** the control endpoint is **unauthenticated and binds all
> interfaces** — any caller that can reach the port can kill a run. Tolerable *only* because this
> runs on a single-node, single-user k3d on the author's machine; **auth and/or a localhost bind
> are a hard prerequisite before control ships beyond the POC** (tracked in Open Questions →
> *Endpoint + auth*).

**Validated live this session:** read-only resolve (both heuristic and authoritative-by-runId),
and a real UI-button kill of a worker (#11) — labels stripped, graceful SIGTERM, comment posted,
**no respawn** after the sweep. The happy path works.

**But the complications are the point:**

| Complication | Why it matters |
|---|---|
| Intricate `/proc` PID resolution + refuse-on-ambiguity + runId cross-check | Large surface just to *identify* the target, because identity must be reverse-engineered from outside. |
| Must strip labels **before** kill to beat the respawn sweep | An ordering/race dependency baked into the protocol. |
| Edge cases only a live run could surface | `grep\|head` SIGPIPE under `pipefail` (→ `grep -m1`); `/proc` scanner self-match (→ exclude `$$`); doubled-runId in the trace header — all found and fixed in-session. The *recurrence* of such cases is itself the finding: reverse-engineering identity from outside is inherently bug-prone. |
| Run-state heuristic (no result + recent mtime = running) can disagree with reality | Stop button can render on a phantom or hide on a live run; `/proc` is the real truth at click time. |
| **Worker-stop leaves the worker's already-opened PR orphaned** | Killed worker had opened `🏗️ PR #12` + branch `agent/issue-11`. Inert (the `🏗️` prefix keeps the reviewer off it), but a loose end the external kill can't reconcile. |
| **Reviewer-stop is impossible cleanly from outside** | Requires setting the internal `reviewed[key]=headSha` marker (`dispatcher.ts:1312`); no external lever reaches it. A killed reviewer respawns until the 2-strike fail-close. **The hard wall.** |

### 3. Manual moderation hits the same wall
Renaming/editing a PR — even an untagged personal one — trips the reactive sweep into an
unwanted spawn (drop the `🏗️` prefix and you've literally signalled "review me"). The operator
has **no hands-off signal**. Convention-safe terminal move today: **close** the PR (closed PRs
leave the sweep's open-PR scan) — never rename.

### Operational gotcha (not architectural)
Neither mitoscope nor the agents image hot-reloads. A stale running process served pre-feature
routes (404/409) until restarted. Re-`restart` after any edit; agents changes need a redeploy.

---

## Root-cause pattern

Every external lever is **per-case** — label-strip for a worker, *nothing* for a reviewer, close
for a PR — so there is **always an exception or a loose end**. The cause is singular: the
dispatcher has **no notion of operator intent / "parked" state**. External control is faking,
from outside, a decision that lives inside — which is why it's fragile, incomplete (reviewer),
and orphan-prone.

---

## Agreed direction (the cleaner solution)

**Split read from write. Unify control into one dispatcher-native intent primitive.**

1. **Observation stays external.** mitoscope remains the kubeconfig-only, droppable, read-only
   sidecar. Unchanged. No coupling.
2. **Control becomes dispatcher-native and singular.** All swat-downs are one concept —
   *"operator says hands-off this {run | PR | item}, authoritatively."* Implement as:
   - a single **`isHeld(owner, repo, item)` gate** consulted at the top of **every** spawn
     chokepoint (`maybeWork`, `maybeReview` incl. the `:1312` reviewed-gate, the sweep `:2259`,
     `maybeBootstrap`), and
   - a single **verb** (`cancel-run` / `hold` / `release`) recorded in dispatcher state.
   One gate above all spawn conditions covers worker + reviewer + builder + future roles, and
   **eliminates the exceptions by construction** (a single union point vs. per-case external
   levers that each leave a hole).
3. **Going internal DELETES complexity.** The `/proc` PID resolution, the label-strip-before-kill
   race, the run-state heuristic, and the reviewer exception all evaporate — the dispatcher holds
   the real process handle and owns the markers. For *control*, internal is strictly simpler.

### Accepted cost
A **bounded version dependency**: one endpoint contract + one gate clause, shipped as the next
versioned agents image (`Dockerfile` → CI → helm/Flux). You own that build/deploy and merge
upstream dispatcher changes — acceptable because the agents repo is yours, and the trade buys a
*simpler, complete* tool instead of an ever-growing pile of external edge cases.

> Status note: a native `POST /cancel` (live-proc registry + `Dispatcher.cancel`) was
> **spiked to prove the internal design, then deliberately reverted to keep the `~/Desktop/agents`
> tree clean**. The design is **proven**; the code is intentionally **not** in-tree. So this is
> re-implement + own-the-deploy, not "finish what's there."

### Design principles (locked this session)

- **The read/write split is a product boundary, not a flag.** Observability is the standalone
  core — zero dispatcher-version assumptions, works against any cluster with a kubeconfig,
  shareable freely. Control is a separate, **opt-in** capability layered on top ("here's my
  toolkit; wire your orchestrator to it if you want").
- **Invert the dependency: control defines a contract; the dispatcher implements it.** Rather than
  mitoscope depending on a specific dispatcher build, the control layer publishes a small,
  **versioned, implementation-agnostic API** (`cancel-run` / `hold` / `release` / `query-state`).
  The dispatcher — current or whatever it becomes — is *one adapter* to that contract. This keeps
  liability off the author: an unpatched/foreign orchestrator simply gets observability only.
- **Capability handshake, not assumption.** On connect, the control layer negotiates "do you
  implement control-contract vN?" — the current startup preflight generalized from "is the pod
  shaped right" to "does the orchestrator satisfy the contract." Control features light up only on
  a satisfied contract; otherwise they stay dark and observability is unaffected.

### Delivery principle (locked this session)

- **Define control fully now; build observability first.** Specify the whole design — control
  included — so the observability foundation is laid with the control hook-points in mind and never
  precludes them. Then build in a **phased roadmap of small, reviewable commits**: a solid
  standalone observability core first (stable, valuable on its own), then the control contract,
  then the control client on top. The current POC is reference, not the base.

### Cross-repo model (consumer/contract split)

mitoscope-control and the `agents` dispatcher are **two repos with a versioned interface contract
between them** — a normal consumer/contract pattern (think client SDK vs server API). It minimizes
the new cross-codebase coupling: observability depends on `agents` for *nothing*; control depends
only on `agents` implementing the *stable contract*, not on arbitrary dispatcher progress. The
dispatcher-side changes (the `isHeld` gate + endpoint) live and are documented **in the `agents`
repo** (e.g. `agents/CONTROL.md`); mitoscope carries a **"required dispatcher patches / minimum
version"** index plus a **compatibility matrix** (`mitoscope-control vX ↔ agents vY ↔ contract vZ`).
The handshake enforces compatibility at runtime; the matrix documents it for humans.

---

## Observability foundation — recorded requirements (this session)

**Guiding principle:** liveness and data must come from **in-memory truth + direct reads**, not
from the buffered log stream or the workload pod's lifecycle. The dispatcher log is *enrichment*
(triggers/causality), never the liveness clock. This single principle dissolves both the spawn lag
and the scale-to-0 blindness below.

1. **Fast spawn detection (kills the 1–3 min lag).** Detect runs from `GET :9909/healthz`
   (`activeRuns`/`queued`, in-memory, unbuffered) + a scan of `/data/work/<runId>` (the workdir
   appears the instant a run starts), polled every ~2–3 s. Demote the log stream to enrichment.
   *Cause of the lag: the dispatcher's Bun stdout is block-buffered to a pipe, so low-volume lines
   surface in minute-late bursts.* HIGH priority — core to "catch surprise agents / monitor token use."
2. **Spawn notifications.** macOS host has `osascript` → server-side native notification + sound
   even with no tab open; plus browser `Notification` + audio ping when focused. Depends on #1 for
   timeliness.
3. **Decouple data access from the workload pod.** Everything today flows through the live `agents`
   pod (`kubectl logs` + `kubectl exec` into `/data`), so `scale --replicas=0` blinds mitoscope and
   an in-tool replicas toggle would self-blind. The `agents-data` PVC is `RWO local-path` on a
   single-node k3d, so a tiny **read-only reader pod** can mount it and serve history independent of
   whether `agents` is scaled up. (The replicas 1/0 toggle itself is a *coarse "pause the crew"*
   action → control layer, with the self-blind caveat mitigated by the reader pod.)
4. **Timestamped feed.** `queuedAt`/`finishedAt` (live events) + file `mtime` (scan) are already
   present → absolute + relative times, optional time-window grouping. Trivial. Caveat: file-only
   (older-than-buffer) runs have only `mtime` (≈ finish), not a start time.

---

## Decisions (resolved this session)

### Cluster 1 · D1 — Hold signal = a Forgejo `agent-hold` label
**Decision:** *suppression* is driven by a single dispatcher **gate that reads an `agent-hold` label**
at every spawn chokepoint (`maybeWork`, `maybeReview` *before* the reviewed-sha check, the sweep,
`maybeBootstrap`). **Why:** simplest mechanism covering the dominant pain — suppression across all
roles incl. the reviewer via one gate; human-usable from the Forgejo UI (also fixes
manual-rename-triggers-an-agent); visible; survives restarts; one contained dispatcher change; one
convention, not a web. Internal state is **reserved for live-process cancellation only** (a later
decision), not a second suppression authority. **Trade accepted:** label grain is per-item, not
per-run (fine for suppression). **Framing:** control has two jobs — *suppression* (don't spawn /
respawn) and *live termination* (kill the running proc); this decision settles suppression's source
of truth.

### Cluster 1 · D2 — Granularity = per-item
**Decision:** holds are **per-item** — the `agent-hold` label sits on the specific issue or PR to
freeze (label the issue → stop the worker; label the PR → stop the reviewer). **Global** "pause the
whole crew" is covered by the separate **replicas 1/0 toggle** (its own coarse control, with the
self-blind caveat + reader-pod mitigation). **Per-repo** ("pause a whole app") is **deferred** — it's
the one scope with no clean label home (would force dynamic internal state / a convention hack) for a
need not yet felt; revisit as a held-repo-set extension only if it proves real. **Issue↔PR wrinkle:**
no auto-propagation across `Closes #N` in v1 — label both items to freeze a whole feature (explicit >
clever); propagation noted as a future nicety.

### Cluster 1 · D3 — Reversibility = remove-label / passive / sticky
**Decision:** (a) **release = remove the `agent-hold` label** — the label's presence is the single
source of truth (tools and humans both release by removing it); (b) **passive behavior** — un-gating
lets the existing sweep / un-label webhook re-evaluate and continue a **fresh run from the durable
Forgejo+git artifacts** (no resume/checkpoint machinery; lossless for committed work — statelessness
guarantees it; only *uncommitted* edits in a separately-killed live run's ephemeral workdir are lost);
(c) **sticky until explicitly removed** — no auto-expiry (silent un-parking is a moderation footgun).
**Scope note:** these semantics govern the per-item label-hold; the global replicas pause reverses by
scaling back up — orthogonal mechanism, same passive/stateless spirit (restarted dispatcher re-derives
eligible work from Forgejo). Compatible, distinct verbs: *release a hold* (remove label) ≠ *un-pause
the crew* (scale up).

### Cluster 2 · D1 — Reviewer stop = the label-gate (no `reviewed`-marker manipulation)
**Decision:** the reviewer is **no longer a special case** — the D1 `agent-hold` gate sits in
`maybeReview` *before* the `reviewed[key]===headSha` check, so a hold suppresses the reviewer
identically to every other role: reversible, visible, no strikes accrued (suppressed ≠ crashed), and
**without lying about review state**. **Rejected:** (B) operator-sets-`reviewed=headSha` "give-up" —
corrupts the dispatcher's review bookkeeping + audit and isn't cleanly reversible; (C) a distinct
`cancelled` flag — a redundant second suppression authority D1 already eliminated. **Residue:** a
*live* reviewer to stop mid-run is the separate **live-termination** job (kill the proc) — the label
already prevents respawn; deferred to the cancel-endpoint decision.

### Cluster 2 · D2 — Orphaned PR on cancel = park, don't close
**Decision:** a **cancel = kill the live proc + `agent-hold` the affected item(s)** (the issue *and*
the PR it opened — an internal cancel knows the run context, so this is an explicit operation, not the
passive propagation declined in Cluster 1·D2). The partial work is **preserved and resumable** (release
→ a worker continues the existing PR), respawn is prevented, and the reviewer stays off it (gate + the
`🏗️` prefix). Orphan handling thus reduces to **the hold we already designed — no new mechanism**. The
kill record **names what it parked**. **Discard** (close PR + delete branch) stays an explicit opt-in
for throw-away cases — *not* the default, because the default preserves work (consistent with D3).
**Rejected:** (C) leave-and-flag — the POC's unmanaged-loose-end behavior (PR #12 just sat there).

### Cluster 2 · D3 — Idempotency & audit = tiered, Forgejo-native, idempotent by construction
**Decision:** preserve "never silent" without spam via a **tiered** audit: (a) **hold/release** are
self-auditing — the `agent-hold` label + Forgejo's native item timeline (who/when) *is* the record, no
comment; (b) **cancel** posts **one loud comment** naming the killed run, the actor (operator via the
control layer), what was parked (issue + PR), and how to resume (remove the label) — the POC's
loud-trace principle, kept; (c) **every action also lands in the dispatcher's structured log** as
enrichment for mitoscope's view. **Idempotency by construction:** add/remove-label are no-ops if
already in the target state; cancel = kill-**if-alive** + ensure-held (a dead proc / already-held item
are no-ops); the gate is read-only. **Rejected:** (B) comment-on-every-action (park/unpark spam);
(C) internal-log-only (a killed run invisible to anyone reading the PR).

### Cluster 3 · D1 — Contract shape = minimal, mitoscope-owned, semver'd
**Decision:** the contract an orchestrator implements is minimal — (1) a **passive label-gate
convention** (honor `agent-hold` at every spawn chokepoint; hold/release applied via plain Forgejo,
*no endpoint*, preserving the human UI escape hatch), (2) **one active `cancel` endpoint** (kill live
proc + park, per Cluster 2·D2 — the only op needing the dispatcher's process handle), (3) a
**capability/version handshake**. **Owned/defined by mitoscope** (consumer-defines-the-contract
inversion); the spec lives in the mitoscope repo (`docs/CONTROL-CONTRACT.md`), **semver'd
independently**; the dispatcher implements it and declares its version. Effective surface ≈ *"honor one
label + expose one cancel verb + announce your version."* **Rejected:** (B) fuller RPC for all verbs —
loses the human-usable label. **Pivot note:** A→B is *additive and cheap* (endpoints that wrap the same
label = minor version bump, anytime); the costly pivot (internal-state-as-truth, dropping the label) is
the deferred Cluster 1·D1 "option C," taken only if per-run grain or locked/auth'd holds become a real
need — shippable as a major version without breaking existing deployments.

### Cluster 3 · D2 — Capability handshake = `GET /control/capabilities`, semver-negotiated, degrade-on-mismatch
**Decision:** discovery via a dedicated **`GET /control/capabilities` → `{contractVersion, verbs[]}`** —
the *generalized preflight* (internal cancel deletes the POC's pod-shape checks, so the handshake is
purely "do you implement contract vN?"). **Negotiation = semver:** major must match, dispatcher minor ≥
the feature floor, degrade per-feature (additive minor bumps stay backward-compatible). **Mismatch:**
absent/unreachable or major-mismatch → control **off**, observability unaffected, **banner explains
why**; minor-behind → light up supported features only, surface the rest. Same "preflight fails →
disabled + banner" UX as the POC, but keyed on a versioned contract, not pod shape. **Rejected:**
(B) implicit version metadata (brittle, no partial support), (C) probe-based (can't pre-light the UI
or tell unsupported from transient).

### Cluster 3 · D3 — Endpoint location & auth = kubectl-exec transport + localhost-binds
**Decision:** control reaches the dispatcher via **`kubectl exec … curl localhost:9909/…`**; the
dispatcher's control endpoints (`cancel`, `capabilities`) bind **localhost-in-pod** (exec-only, never
network-exposed); mitoscope's local server binds **127.0.0.1** (closes the POC's all-interfaces /
unauthenticated mutating-endpoint hole). **Authorization = cluster access / RBAC** — a strictly *lower*
privilege than the kill power you'd already have with it; **no new auth scheme**. The contract stays
**HTTP + transport-agnostic** (exec is just the zero-config default). **Rejected for v1:** (B)
port-forward + bearer token, (C) ingress + real auth (overkill for a local single-user tool). **B is
deferred as an additive future transport — see below.**

### Cluster 3 · D4 — Control client = a separate opt-in module (same UI/process)
**Decision:** the read/write split is realized as a **module boundary, not a runtime flag**. Control is
a self-contained module the observability core has **zero dependency on** — observability publishes/runs
with the module **absent** (genuinely read-only, the shareable deliverable), or **present + enabled +
handshake-passing**, in which case it mounts its `cancel` call and injects the stop button into the
**same dashboard** (one process, one integrated UI). `CONTROL=1` now gates *loading a module that must
also be present*, not flipping always-shipped code. **Rejected:** (A) single binary + flag (the
"read-only" build still ships mutating code — the flag-not-boundary the principle forbids); (C) two
separate tools (loses the stop-button-in-the-run-list UX; two things to run).

### Cluster 4 · D1 — Clean rebuild (POC strictly reference, no code ported)
**Decision:** the greenfield is a **pure clean rebuild** — the POC is reference only; **no code is
ported**. Everything is built fresh from commit #1: the new acquisition model (`healthz`+workdir
liveness, decoupled reader-pod data access, log-stream-as-enrichment), the module split, control as a
separate module. **Rejected:** (B) refactor-in-place, (C) hybrid/salvage — even the proven pure-logic
pieces are re-implemented fresh. **Value-preservation (compatible with a clean rebuild):** the POC's
hard-won **edge cases carry as documented reference, not code** — re-handled by design, not
re-discovered as bugs. The checklist the rebuild must satisfy:
- stream-json per-message `output_tokens` **undercounts ~7–9×** → cost is only trustworthy from the
  final `result` event (mid-run cost is unavailable by nature).
- **run-state heuristic** — result present = done; absent + fresh mtime = running; absent + stale =
  *incomplete* (don't let "no result = running" create phantom runs). *(Now reinforced by `healthz`
  `activeRuns` as the authoritative liveness signal.)*
- transcript timeline: **tool_use↔tool_result pairing** + ~4 KB payload truncation.
- (control-era) any `/proc` scan: `grep -m1` (not `grep|head`, SIGPIPE under `pipefail`) and exclude
  `$$` (self-match on the discriminator). *(Largely moot once cancel is internal — the dispatcher owns
  the proc handle — but kept for any residual external scanning.)*
These live in the POC docs (`../mitoscope-poc/AGENT-KILL.md`) + this file.

### Cluster 4 · D2 — Phased roadmap (integer phases, observability-first)
**Decision:** small reviewable commits within each phase; observability ships standalone before any
control work.
- **Phase 0 — Scaffold.** Repo, README, docs, `.gitignore`. *(commit #0, owner-made — ✅ ready)*
- **Phase 1 — Observability core** (standalone, read-only, shippable). The **data-access seam** (a
  source abstraction — *the key foundational investment; makes the backend swappable with no consumer
  rewrite*) + `healthz`/workdir fast liveness + log-as-enrichment; `/runs` (live+historical) with the
  done/running/incomplete heuristic; transcript-timeline parser (edge cases by design); cost rollup;
  SPA (RUNNING/RECENT, collapsible transcript, cost header, **timestamped feed**); **notifications**
  (osascript + browser — the payoff of fast detection); lifecycle script + **127.0.0.1 bind**.
- **Phase 2 — Decoupled data backend.** Implement the seam against a source independent of the
  agents-pod lifecycle so history survives scale-to-0. **Lean: local mirror** (periodic `kubectl cp`/
  rsync of `/data`) to preserve the nothing-in-cluster ethos; reader-pod is the always-current
  alternative (chosen at build time). Only *data-at-rest* needs this; live signals stay agents-pod-bound.
- **Phase 3 — Control contract (`agents` repo).** `agent-hold` gate at every spawn chokepoint; `cancel`
  endpoint (kill+park); `GET /control/capabilities`; `agents/CONTROL.md` + cut a versioned image.
- **Phase 4 — Control module (mitoscope, opt-in).** Handshake client + degrade-to-observability;
  hold/release via Forgejo label + cancel via exec→dispatcher; UI injection (stop/hold/release +
  banner); compatibility matrix + min-version index.

**Sequencing rule:** the replicas-toggle control feature **depends on Phase 2** (decoupled data) — never
ship it before Phase 2, or it blinds the tool. *(Earlier "Phase 1.5" folded into Phase 2; later phases
shifted accordingly.)*

### Cluster 4 · D3 — Cross-repo docs & versioning = doc + machine-readable capabilities
**Decision:** the cross-repo dependency is governed by — contract spec single-source-of-truth in
**mitoscope** (`docs/CONTROL-CONTRACT.md`, semver'd independently); dispatcher-side implementation
documented in **`agents/CONTROL.md`** declaring the version it implements; a **compatibility matrix**
(`mitoscope-control vX ↔ agents vY ↔ contract vZ`) + a "required patches / min version" index in
mitoscope, updated per release. **Conformance model:** the doc is the human spec; the **`GET
/control/capabilities` payload (`{contractVersion, verbs[]}`) is the machine check** the client
validates against its expected set — runtime-verified, not trusted from prose (nearly free given
C3·D2). **Semver policy:** additive = minor (backward-compatible; label stays truth), breaking = major
(internal-state pivot); handshake negotiates major-match + minor-floor. **Rejected:** doc-only +
version string (drift between prose and reality).

---

## Deferred / future additions (with triggers)

Each is **additive** — layerable later without undoing v1, because the versioned contract + capability
handshake absorb new transports/verbs as minor (or, where noted, major) version bumps.

- **Transport B — port-forward + bearer-token HTTP** (alternative to the kubectl-exec transport).
  *Trigger (any one):* (1) control must originate from a client **without** kubeconfig/cluster access
  (a hosted dashboard, a CI job, a teammate's machine); (2) you need **per-operator identity / authz /
  revocation** rather than "shared cluster access = control"; (3) you want to grant **control-only
  without granting exec/kill RBAC** (privilege separation); (4) **high-frequency/programmatic** control
  where per-call `exec` process overhead bites. *Cost:* dispatcher implements token validation + you
  manage tokens; **minor** contract bump (new transport, same verbs) — the exec path keeps working.
- **Token / defense-in-depth on mitoscope's local server.** *Trigger:* mitoscope is run on a
  **shared/multi-user host**, where 127.0.0.1-bind alone is no longer a sufficient boundary.
- **Per-repo hold granularity** (Cluster 1·D2). *Trigger:* "pause a whole app" becomes a recurring move
  → add a dynamic held-repo set.
- **Issue→PR hold auto-propagation** across `Closes #N` (Cluster 1·D2). *Trigger:* labelling both items
  to freeze a feature proves tedious in practice.
- **Hold auto-expiry / TTL** (Cluster 1·D3). *Trigger:* a clear opt-in need for time-boxed parks
  (kept off by default — silent un-parking is a moderation footgun).
- **Additive contract endpoints wrapping the label** (Cluster 3·D1, "B-additive"). *Trigger:* tooling
  wants a uniform API surface → minor bump, label stays the source of truth.
- **Internal-state-as-truth pivot** (Cluster 3·D1, "B-replacing" / the deferred Cluster 1·D1 option C).
  *Trigger:* **per-run** granularity or **locked/auth'd** holds become a real need → major bump,
  ships without breaking existing deployments.

---

## Open questions for the greenfield design

To be reasoned through in dependency-ordered clusters before the spec is written.

### Cluster 1 — Signal & source of truth (defines the core primitive) — ✅ RESOLVED (see Decisions)
- **Hold signal mechanism:** a Forgejo label (`agent-hold`) the gate reads (human-usable + visible,
  but is itself reactive state) vs. an internal-only cancel record (authoritative but invisible to
  humans) vs. **both** (label as the human-facing mirror of the internal record).
- **Granularity:** cancel a single *run* vs. hold an *item* (issue/PR) vs. hold a whole *repo*.
- **Reversibility:** is `hold` releasable, and how is release surfaced (remove label / endpoint)?

### Cluster 2 — Lifecycle semantics — ✅ RESOLVED (see Decisions)
- **Reviewer semantics:** stop = set `reviewed[key]=headSha` (give-up) vs. a distinct `cancelled`
  state the dispatcher records.
- **PR orphan handling on cancel:** close vs. park (draft/hold) vs. leave-and-flag.
- **Idempotency / audit:** how is an operator action recorded (comment? state field? both) so it's
  never silent — preserving the POC's "loud trace" principle.

### Cluster 3 — Surface, contract & ownership — ✅ RESOLVED (see Decisions)
- **Contract shape & ownership:** the control API verbs + where the spec lives (mitoscope defines
  it?) and how it's **semver'd independently** of both tools.
- **Capability handshake:** how the control layer discovers compatibility (`GET /control/capabilities`
  + version? declared min-agents-version?) and behavior on mismatch (degrade to observability +
  surface why).
- **Endpoint + auth:** lives on the dispatcher (`:9909` alongside `/hook`, `/healthz`)? The control
  surface is currently unauthenticated and binds all interfaces (flagged as a known POC risk in §2);
  resolving this — require auth and/or localhost-bind — is a **hard prerequisite** before control
  ships, not an open preference.
- **Control client ownership:** does mitoscope stay the UI for control (calling the contract), or
  does control move to a **separate opt-in module/client** to keep the observability sidecar truly
  read-only and independently shippable?

### Cluster 4 — Delivery & cross-repo (process) — ✅ RESOLVED (see Decisions)
- **Rebuild vs. refactor:** does the greenfield observability foundation restart clean or
  harden/restructure the validated POC core? (Shapes commit #1.)
- **Phased roadmap:** the commit-sized milestones for observability-first → contract → control.
- **Cross-repo documentation & versioning:** where `agents`-side changes are documented
  (`agents/CONTROL.md`), the mitoscope "required patches / min version" index, and the
  compatibility-matrix discipline.
