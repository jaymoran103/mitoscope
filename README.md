# mitoscope

A lightweight, local observability tool for a self-hosted agent platform (the `mitosis` k3d crew).
It shows what agents are running right now, what triggered them, a readable transcript, and token
cost — by reading the cluster read-only through `kubectl`. Nothing is deployed in-cluster; the only
dependency is a kubeconfig.

> Status: greenfield rebuild, design phase. This is the clean re-implementation. The proof-of-concept
> it grew from is kept for reference at [`../mitoscope-poc`](../mitoscope-poc).

## Architecture

A read/write split, so the tool stays shareable regardless of platform version:

- Observability is the standalone core — no platform-version assumptions, works against any cluster
  with a kubeconfig. Built first.
- Control is opt-in, layered on top via a versioned, dispatcher-side contract. The orchestrator
  implements the contract; an unpatched one simply gets observability only.

## Documentation

- [`docs/DESIGN.md`](docs/DESIGN.md) — the build brief: architecture, the observability and control
  specs, the contract, and the phased roadmap. Start here.
- [`docs/notes/`](docs/notes/) — working notes behind the design: the decision journal
  ([`operator-control-learnings.md`](docs/notes/operator-control-learnings.md)) and the cost-tracking
  research ([`usage-estimate-takeaways.md`](docs/notes/usage-estimate-takeaways.md)).

## License

TODO — pick a license before publishing (intended to be shareable, e.g. a Forgejo repo mirrored to
GitHub).
