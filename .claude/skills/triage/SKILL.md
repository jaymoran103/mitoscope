---
name: triage
description: Use at phase boundaries or when choosing what to work on next. Reviews the roadmap (DESIGN §7), phase progress (ACCEPTANCE.md), and the backlog (docs/BACKLOG.md) together, then proposes a ranked next item with rationale and a routing verdict per backlog entry. Proposes only — the human decides.
---

# Triaging roadmap + backlog

Agent proposes, human decides. This skill produces a recommendation. It never starts work,
edits the chosen target, or commits — the human gates every choice, mirroring the commit loop.

## Steps

1. **Read the three sources:**
   - `docs/DESIGN.md §7` — the roadmap and which phase is current.
   - `docs/ACCEPTANCE.md` — progress within the current phase (what is left to ship it).
   - `docs/BACKLOG.md` — the open emergent concerns.

2. **Rank candidates.** Consider both unstarted roadmap/ACCEPTANCE work and backlog concerns
   together. Weigh each by severity / blast-radius and whether it blocks current-phase work,
   against how close the current phase is to done. The goal is one answer: what to take next.

3. **Route each backlog concern** — issue exactly one verdict per entry:
   - **take** — do it now (small, current-phase, unblocks progress).
   - **promote to ACCEPTANCE** — it is really current-phase build work; it belongs in the
     definition of done. (Proposed move; the human applies it.)
   - **take as design pass** — it is design-class; resolving it needs a brainstorming pass.
     The backlog entry is that pass's input and is removed when the pass concludes. The pass's
     output lands in `DESIGN` (if it amends the brief/roadmap) or, only if the pass concludes
     "defer with a trigger," the deferred-additions list. Never write a raw concern into the
     decision journal.
   - **leave** — real but not yet actionable (e.g. a future-phase concern); it stays in the
     backlog for a later pass.
   - **drop** — no longer relevant; remove it with a one-line reason in the commit. (Proposed.)

4. **Propose, then stop.** Output: the ranked next item + rationale, and the per-entry verdicts.
   Do not start the work, edit ACCEPTANCE/DESIGN/BACKLOG, or commit. Hand the decision to the
   human. When the human approves a verdict that moves or removes an entry, that edit is a
   separate, human-gated step.

## Note

Triage deliberation is volatile — do not persist it to a log file. The durable "why" lands in
the commit message or the satisfied ACCEPTANCE check when the chosen work is actually done.
