'use strict';

// Normalize a stream-json transcript into an ordered timeline the SPA can render
// (DESIGN §2: `thinking / text / tool_use (+ result) / result`). The two §8 edge cases
// are handled here by design, not rediscovered as bugs:
//   - tool_use is paired with its tool_result by id; an unpaired tool_use (a run killed
//     or still streaming mid-tool) keeps `result: null` rather than vanishing.
//   - tool payloads are truncated at ~4 KB so one giant Read/Bash result can't bloat the
//     timeline.
// Non-JSON preamble (e.g. the git-clone banner a worker emits before stream-json begins)
// is skipped. This is a pure function over text — it runs above the seam and is tested
// against captured fixtures, never a live cluster.

const DEFAULT_MAX_PAYLOAD = 4096;

// Truncate to `maxBytes` UTF-8 bytes (DESIGN §8 budgets bytes, not characters),
// appending a marker that names the omitted byte count so the UI shows the payload was
// clipped, not lost. The cut is backed off the UTF-8 boundary so a multibyte char is
// never split into a lone continuation byte.
function truncate(str, maxBytes) {
  const byteLen = Buffer.byteLength(str);
  if (byteLen <= maxBytes) return str;
  const buf = Buffer.from(str, 'utf8');
  let end = maxBytes;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--; // back off a continuation byte
  return `${buf.toString('utf8', 0, end)}\n…[truncated ${byteLen - end} more bytes]`;
}

// A tool_result's `content` arrives as a string, or an array of text / tool_reference
// items, or (rarely) an object. Flatten to a single display string before truncation.
function flattenToolResult(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((it) => {
        if (typeof it === 'string') return it;
        if (it && it.type === 'text') return it.text || '';
        if (it && it.type === 'tool_reference') return it.tool_name || '';
        return JSON.stringify(it);
      })
      .join('\n');
  }
  return JSON.stringify(content);
}

function parseTranscript(raw, opts = {}) {
  const maxPayload = opts.maxPayload || DEFAULT_MAX_PAYLOAD;
  const timeline = [];
  const byToolId = new Map(); // tool_use id -> its timeline entry, for pairing
  let meta = null;
  let result = null;

  for (const line of String(raw).split('\n')) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue; // non-JSON preamble (git clone, etc.)
    }

    if (o.type === 'system' && o.subtype === 'init') {
      meta = { model: o.model || null, sessionId: o.session_id || null, cwd: o.cwd || null };
      continue;
    }

    if (o.type === 'assistant' && o.message && Array.isArray(o.message.content)) {
      for (const it of o.message.content) {
        if (it.type === 'thinking') {
          timeline.push({ kind: 'thinking', text: it.thinking || '' });
        } else if (it.type === 'text') {
          timeline.push({ kind: 'text', text: it.text || '' });
        } else if (it.type === 'tool_use') {
          const entry = {
            kind: 'tool_use',
            id: it.id || null,
            name: it.name || null,
            input: truncate(JSON.stringify(it.input ?? null), maxPayload),
            result: null, // paired below; stays null if the run ended mid-tool
          };
          timeline.push(entry);
          if (it.id) byToolId.set(it.id, entry);
        }
      }
      continue;
    }

    if (o.type === 'user' && o.message && Array.isArray(o.message.content)) {
      for (const it of o.message.content) {
        if (it.type !== 'tool_result') continue;
        const payload = {
          content: truncate(flattenToolResult(it.content), maxPayload),
          isError: !!it.is_error,
        };
        const entry = byToolId.get(it.tool_use_id);
        if (entry) {
          entry.result = payload;
        } else {
          // tool_result with no preceding tool_use — surface it rather than drop it.
          timeline.push({ kind: 'tool_result', id: it.tool_use_id || null, orphan: true, ...payload });
        }
      }
      continue;
    }

    if (o.type === 'result') {
      result = {
        kind: 'result',
        subtype: o.subtype || null,
        isError: !!o.is_error,
        durationMs: o.duration_ms ?? null,
        numTurns: o.num_turns ?? null,
        // Cost is trustworthy only from the final result (DESIGN §8); the rollup that
        // sums these across runs lives in src/cost.js.
        totalCostUsd: typeof o.total_cost_usd === 'number' ? o.total_cost_usd : null,
        text: o.result ?? '',
      };
      timeline.push(result);
    }
  }

  // `result` is null when the transcript has no final result line — the on-disk shape of
  // a run that is still streaming or was killed (the running/incomplete states).
  return { meta, timeline, result };
}

module.exports = { parseTranscript, truncate, flattenToolResult, DEFAULT_MAX_PAYLOAD };
