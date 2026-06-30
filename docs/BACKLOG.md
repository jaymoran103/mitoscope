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

_None yet._
