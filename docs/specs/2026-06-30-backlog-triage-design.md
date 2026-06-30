# Backlog + triage system — design

A low-friction capture surface for emergent implementation concerns, plus a skill that
reviews the roadmap and that backlog together and proposes what to take on next. Capture and
review are split into two thin skills so observing a concern never derails the work in progress.

## Why

The repo already runs most of an issue-management pattern, but one stream has no home:

- **Roadmap** — [`DESIGN.md §7`](../DESIGN.md): the planned phases.
- **In-phase definition of done** — [`ACCEPTANCE.md`](../ACCEPTANCE.md): the falsifiable checklist.
- **Vetted design deferrals (with triggers)** — [`notes/operator-control-learnings.md`](../notes/operator-control-learnings.md)
  `§ Deferred / future additions`: design choices consciously punted, each gated by a trigger.

What is missing is the *emergent* stream: bugs, fragilities, missing edge cases, and
"this will bite us in Phase 2" friction noticed **while building**. These are bottom-up
observations, not vetted design decisions — dropping them into the decision journal would
turn a retrospective record into a living inbox. They need their own surface.

## Scope

In scope: emergent, observed-while-building concerns only. Out of scope: design deferrals
(already handled by the deferred-additions list) and final-phase DoD (handled by ACCEPTANCE).

## Decisions locked

- **Capture stream:** emergent implementation concerns, distinct from design deferrals.
- **Triage model:** agent proposes, human decides — mirrors the existing commit loop. Triage
  never starts work or commits; it produces a recommendation a human gates.
- **Mechanism:** a pair of thin project skills (`/backlog` capture, `/triage` review), the
  repo's first skills. Process tooling only — no product code, so the zero-runtime-dependency
  ethos is untouched.
- **Triggering:** soft convention (CLAUDE.md tells the agent when to invoke), not a hook.
  Pull over push, matching the human-in-the-loop ethos. A SessionStart/Stop hook is the
  graduation path if triage proves easy to forget.

## Architecture

| Artifact | Status | Purpose |
|---|---|---|
| `docs/BACKLOG.md` | new | Capture surface. Holds only *open* concerns. |
| `.claude/skills/backlog/SKILL.md` | new | `/backlog` — capture: dedup, stamp, append. |
| `.claude/skills/triage/SKILL.md` | new | `/triage` — review roadmap + backlog, propose next. |
| `CLAUDE.md` | edit | Add BACKLOG.md to the source-of-truth list; add a "backlog loop" convention. |

### The boundary model (keystone)

Every concern has exactly one home, so no artifact accretes content that belongs elsewhere.

| Home | Holds | A concern lands here when… |
|---|---|---|
| `BACKLOG.md` | All open emergent concerns (build- and design-class). *Unvetted.* | Observed mid-task; should not derail current work. |
| `ACCEPTANCE.md` | In-scope current-phase DoD items. | Triage finds a backlog item is current-phase build work → promote. |
| `operator-control-learnings § Deferred additions` | Vetted *design* deferrals with a trigger. | A design pass concludes "defer with trigger" — never written by triage directly. |
| `DESIGN.md §7` roadmap | The committed phase plan. | Never written by capture; triage only *reads* it. A resolved design pass may amend it. |

### Triage routing

Triage is the router. For each candidate it reads, it issues one verdict:

| Verdict | Action | Durable output lands in |
|---|---|---|
| Build-class, current phase | Take now, or promote to ACCEPTANCE | ACCEPTANCE checkbox |
| Design-class | Take as a *design pass* (brainstorming); the backlog entry is its input | The pass's output — `DESIGN` if it amends the brief/roadmap, **or** the deferred-additions list *only if* the pass concludes "defer with trigger" |
| Leave | Real but not yet actionable (e.g. a future-phase concern); stays in the backlog for a later pass | — (entry unchanged) |
| Drop | Remove with a one-line reason | Commit message |

The defining property: design-class items stay *in the backlog* (the single prospective queue)
until a design pass consumes them. `operator-control-learnings` is only ever written by a
*completed* design decision — never by triage as a queue. The journal stays retrospective; the
backlog stays prospective; the two never blur.

### Invariant: routing is encapsulated in `/triage`

`/backlog` and `BACKLOG.md` are **route-agnostic** — they capture and store a concern with no
knowledge of how it will be classified or where it might be promoted. The build/design split,
the promotion targets, and the drop criteria all live in one place: the `/triage` skill. The
routing table is a swappable internal of triage, not a contract the capture side depends on.
Routes can be rewritten, a class added, or a target changed with nothing on the capture side
moving — the same "interface right so a later change is a swap, not a rewrite" discipline the
repo applies to the data-access seam (DESIGN §2), here applied to the capture/triage boundary.

## BACKLOG.md entry schema

Each open concern is one `###` block. Low-friction by design; the file header carries this
template verbatim as the freehand escape hatch for when invoking the skill feels like overkill.

- **Title** — one-line symptom.
- **Where** — `file:line` / area / phase.
- **Context** — why it matters, why deferred, what will bite later. The expensive-to-reconstruct
  part, and the whole reason to capture now.
- **Surfaces / blocks** — the promotion signal (mirrors the deferred-additions "trigger" idiom):
  what makes it urgent, or which work it blocks. Optional rough severity.
- **Provenance** — absolute date + phase/commit. Auto-stamped by the capture skill.

Resolved items are **removed** when the fix lands — git holds history, and the "why" lives in
the commit message or the satisfied ACCEPTANCE check. BACKLOG.md never carries struck-through
clutter, matching the repo's "docs state what *is*" rule.

## `/backlog` skill (capture)

Prime directive: capture and continue. The skill must never pull the agent off its current task.

1. Take the concern (from context or user-stated).
2. **Dedup** — scan existing entries; on overlap, append context to that entry instead of
   creating a duplicate.
3. **Stamp** — absolute date + phase/commit from git.
4. Append a well-formed entry per the schema.
5. Return to the task.

## `/triage` skill (review)

Agent proposes, human decides.

1. Read `DESIGN §7` (roadmap, current phase), `ACCEPTANCE.md` (phase progress), `BACKLOG.md`
   (open concerns).
2. Rank candidates by severity / blast-radius and whether they block current-phase work,
   weighed against roadmap progress.
3. Output a ranked recommendation for what to take next (roadmap *or* backlog item) with written
   rationale, and a routing verdict for each backlog item considered.
4. Stop. Do not start work or commit — the human gates the choice.

No triage-log file: the deliberation is volatile (like the commit plan, which CLAUDE.md already
treats as volatile). The durable "why" lands in the commit or ACCEPTANCE when work is chosen.
*(Optional, deferred: a durable triage-log if the deliberation itself proves worth keeping.)*

## Wiring and triggering

CLAUDE.md gains a short **"The backlog loop"** section: capture via `/backlog` on observation;
run `/triage` at phase boundaries (soft convention, agent discretion). BACKLOG.md is added to the
source-of-truth list, named as the emergent-concerns surface — distinct from the deferred-additions
list and from ACCEPTANCE. Link, don't duplicate.

## Lifecycle

```
observe → /backlog (capture + dedup + stamp) → … keep building …
        → phase boundary → /triage (read roadmap + backlog, rank, propose)
        → human decides → take / promote-to-ACCEPTANCE / take-as-design-pass / drop
        → on resolve: remove entry (git = history)
```

## Out of scope (YAGNI)

- **No hook-based auto-firing** of triage in v1 — soft convention first.
- **No separate "open design questions" doc** — the backlog is the single prospective queue;
  a `design-class` tag is enough for triage to route.
- **No triage-log** — deliberation stays volatile unless proven worth persisting.
- **No auto-start** — triage recommends; humans run the work and the commits.
