---
name: backlog
description: Use when you observe a bug, fragility, missing edge case, or "this will bite us later" concern mid-task that should be recorded without derailing current work. Appends a deduped, stamped entry to docs/BACKLOG.md.
---

# Capturing a backlog concern

Prime directive: **capture and continue.** This skill must never pull you off your current
task. Record the concern, then return to what you were doing.

## Steps

1. **Frame the concern** from the current context (or the user's words) into the schema fields:
   - *Title* — one-line symptom (becomes the `###` heading).
   - *Where* — `file:line` / area / phase.
   - *Context* — why it matters, why it is being deferred, what will bite later. Dump the live
     context you have right now; this is the expensive-to-reconstruct part.
   - *Surfaces / blocks* — what makes it urgent, or which work it blocks. Optional rough severity.

2. **Dedup.** Read `docs/BACKLOG.md` and scan the open concerns for an entry covering the same
   root issue (same file/area + same failure mode). If one exists, **append your new context to
   that entry instead of creating a second** — add a Context line; leave its heading and original
   Captured stamp intact. Only create a new entry when no existing one overlaps.

3. **Stamp provenance.** Build the Captured line as `<YYYY-MM-DD> · <short-sha> · <phase>`:
   - date — today's absolute date.
   - short-sha — `git rev-parse --short HEAD`.
   - phase — the phase currently open in `docs/ACCEPTANCE.md` (e.g. `Phase 1`).

4. **Append** the well-formed block under `## Open concerns`, replacing the `_None yet._`
   placeholder if present. Match the entry template in `docs/BACKLOG.md` exactly.

5. **Return to the task.** Do not triage, classify, or start fixing the concern — that is
   `/triage`'s job. State in one line that you logged it, then resume.

## Escape hatch

If invoking this skill is overkill (you are already editing `docs/BACKLOG.md`, or the concern
is trivial), copy the template block from the file header by hand. The skill exists for
consistency and dedup, not as a gate.
