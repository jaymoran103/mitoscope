'use strict';

// A runId names one agent run: `<role>-<owner>-<repo>-<shortid>`, e.g.
// `reviewer-plat-timealign-initial-mqjsc32i2`. It is the filename of a transcript
// (`/data/logs/<runId>.log`) and a workdir (`/data/work/<runId>`), so it crosses the
// seam straight into shell arguments and filesystem paths. Validate it FIRST: the
// 127.0.0.1 bind limits who can reach the SPA, but an attacker-influenced `:id` is
// still a shell-injection / path-traversal vector (DESIGN §8; ACCEPTANCE non-functional).
//
// Allowed shape: lowercase alphanumerics in dash-separated segments, two or more
// segments, leading segment starts with a letter. This admits every real runId while
// rejecting `..`, `/`, whitespace, and shell metacharacters by construction.
const RUN_ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;
const MAX_LEN = 200;

function isValidRunId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= MAX_LEN && RUN_ID_RE.test(id);
}

// Returns the id unchanged when valid; throws otherwise. Use at every point where a
// runId is about to become a shell argument or a path segment.
function assertRunId(id) {
  if (!isValidRunId(id)) {
    throw new Error(`invalid runId: ${JSON.stringify(id)}`);
  }
  return id;
}

module.exports = { isValidRunId, assertRunId, RUN_ID_RE, MAX_LEN };
