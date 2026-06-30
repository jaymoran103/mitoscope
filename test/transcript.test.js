'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createSource } = require('../src/source');
const { parseTranscript, truncate, DEFAULT_MAX_PAYLOAD } = require('../src/transcript');

const src = createSource({ backend: 'memory' });
const REVIEWER = 'reviewer-plat-timealign-initial-mqjsc32i2';
const WORKER = 'worker-plat-timealign-initial-mqi1ilmpq';
const RATE_LIMITED = 'reviewer-plat-timealign-initial-mqiv73zz2';
const INCOMPLETE = path.join(__dirname, 'fixtures', 'transcripts', 'incomplete-unpaired.jsonl');

const kinds = (tl) => new Set(tl.map((e) => e.kind));
const toolUses = (tl) => tl.filter((e) => e.kind === 'tool_use');

test('real reviewer transcript: init meta + thinking/text/tool_use timeline', async () => {
  const { meta, timeline, result } = parseTranscript(await src.readTranscript(REVIEWER));
  assert.equal(meta.model, 'claude-sonnet-4-6');
  assert.ok(meta.sessionId, 'session id captured from init');
  for (const k of ['thinking', 'text', 'tool_use', 'result']) {
    assert.ok(kinds(timeline).has(k), `timeline has ${k}`);
  }
  assert.equal(result.isError, true, 'this run ended on a connection-closed error');
  assert.equal(result.totalCostUsd, 0.2206877, 'cost read from the final result');
});

test('every tool_use is paired with its tool_result on real transcripts', async () => {
  for (const id of [REVIEWER, WORKER]) {
    const { timeline } = parseTranscript(await src.readTranscript(id));
    const tus = toolUses(timeline);
    assert.ok(tus.length > 0, `${id} has tool_use entries`);
    for (const t of tus) {
      assert.notEqual(t.result, null, `${id} ${t.name} paired`);
      assert.equal(typeof t.result.isError, 'boolean');
    }
  }
});

test('worker transcript: git-clone preamble skipped, only valid kinds emitted', async () => {
  const { timeline } = parseTranscript(await src.readTranscript(WORKER));
  const allowed = new Set(['thinking', 'text', 'tool_use', 'tool_result', 'result']);
  for (const e of timeline) assert.ok(allowed.has(e.kind), `unexpected kind ${e.kind}`);
  // The preamble lines ("Cloning into '.'…") must not leak in as entries.
  assert.equal(timeline.some((e) => e.text && e.text.startsWith('Cloning into')), false);
});

test('oversized tool payloads are truncated at ~4 KB (real 19 KB result)', async () => {
  const { timeline } = parseTranscript(await src.readTranscript(WORKER));
  const bound = DEFAULT_MAX_PAYLOAD + 64; // payload + truncation marker
  let sawTruncation = false;
  for (const t of toolUses(timeline)) {
    assert.ok(t.input.length <= bound, 'tool_use input bounded');
    if (t.result) {
      assert.ok(t.result.content.length <= bound, 'tool_result content bounded');
      if (t.result.content.includes('[truncated')) sawTruncation = true;
    }
  }
  assert.equal(sawTruncation, true, 'at least one real payload was actually truncated');
});

test('incomplete transcript: unpaired tool_use kept, no final result', () => {
  const { timeline, result } = parseTranscript(fs.readFileSync(INCOMPLETE, 'utf8'));
  assert.equal(result, null, 'no result line -> running/incomplete');
  const tus = toolUses(timeline);
  assert.ok(tus.length > 0, 'has a tool_use');
  assert.ok(tus.some((t) => t.result === null), 'a tool_use is unpaired (killed mid-tool)');
});

test('rate-limited short run: result with cost 0 and error, message in timeline', async () => {
  const { timeline, result } = parseTranscript(await src.readTranscript(RATE_LIMITED));
  assert.equal(result.isError, true);
  assert.equal(result.totalCostUsd, 0);
  assert.ok(
    timeline.some((e) => e.kind === 'text' && /session limit/i.test(e.text)),
    'the rate-limit message surfaces as a text entry'
  );
});

test('truncate(): short text untouched, long text marked and bounded', () => {
  assert.equal(truncate('hello', 4096), 'hello');
  const big = 'x'.repeat(5000);
  const out = truncate(big, 4096);
  assert.ok(out.length < big.length, 'shorter than input');
  assert.match(out, /\[truncated 904 more bytes\]/);
});
