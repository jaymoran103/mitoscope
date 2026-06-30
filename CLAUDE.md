# mitoscope — working agreement

Conventions every session inherits, so they don't have to be re-pasted into each prompt and don't
get dropped after a context reset. The chat is volatile; the repo is durable — push durable
knowledge (data shapes, edge cases, decisions) into files, not just the conversation.

## Source of truth

- [`docs/DESIGN.md`](docs/DESIGN.md) is the build brief — architecture, specs, contract, roadmap.
- [`docs/notes/operator-control-learnings.md`](docs/notes/operator-control-learnings.md) is the
  decision journal — the "why" behind each spec statement (`Cluster N · DM` references).
- [`docs/ACCEPTANCE.md`](docs/ACCEPTANCE.md) is the Phase 1 definition of done.

Don't restate these elsewhere — link, don't duplicate. Docs state what *is*, not what was removed;
trust git for history.

## Scope discipline

- Build the phase you're in. Phase 1 is the observability core only — read-only, no mutating code.
  Don't reach into control (Phases 3–4).
- The data-access seam (DESIGN §2) is the load-bearing piece. Get the interface right so Phase 2 is a
  swap, not a rewrite.
- Clean rebuild: `../mitoscope-poc` is reference only. Re-handle its edge cases (§8) by design, not by
  porting its code. Keep the zero-dependency Node + vanilla-JS ethos unless there's a strong reason
  to revisit.

## The commit loop

- Work in small, independently reviewable commits. You (the agent) propose each commit's boundary
  and a conventional-commit message; **the human runs every `git commit` — never commit
  unilaterally.**
- As each commit lands, check off the `docs/ACCEPTANCE.md` items it satisfies. The checklist is the
  durable record of phase progress — the one thing that must survive a context reset, so it lives in
  the repo, not the chat. The approved commit plan is volatile; the checklist is how a fresh session
  knows what's already done.
- Never bump a version, tag, or cut a release without an explicit instruction.

## The test gate

- A commit is not proposed until its tests pass.
- Anything that parses real data (transcripts, healthz, workdirs, cost) is covered by fixture-backed
  `node --test`. The suite runs offline against an in-memory implementation of the seam fed by
  `test/fixtures/` — never against a live cluster. The cluster is for *capturing* fixtures, not for
  running tests; exercising the in-memory backend also proves the Phase 2 swap (DESIGN §2) works.
  Where fixtures genuinely don't apply, verify with a live cluster probe and say so.
- When you learn a real data shape from the cluster, capture a sample into `test/fixtures/` *before*
  moving on — so it becomes a durable regression test instead of throwaway session knowledge.
- See `docs/ACCEPTANCE.md` for the per-endpoint and §8 edge-case test requirements, including the
  meta-test that fails when a seam function has no fixture.

## Before "done"

Run the checklist in `docs/ACCEPTANCE.md` and state what you actually verified — tests run, output
seen — rather than asserting completion. If a step was skipped, say so.

## Style

- Lean passes: favor economical work without shortchanging results.
- No decorative emoji in docs, titles, or output. Keep only functional ones where a tool requires it.
- Prefer disabling unavailable UI controls (greyed out) over hiding them — once control affordances
  exist (Phase 4). Phase 1 is read-only and renders no control UI at all; scope discipline wins over
  this rule until then.
