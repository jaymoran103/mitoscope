'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createSource } = require('../src/source');
const { createCostRoller, finalCost } = require('../src/cost');

const memory = createSource({ backend: 'memory' });
const REVIEWER = 'reviewer-plat-timealign-initial-mqjsc32i2';
const INCOMPLETE = path.join(__dirname, 'fixtures', 'transcripts', 'incomplete-unpaired.jsonl');

const approx = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test('rollup sums total_cost_usd from each final result across the corpus', async () => {
  const { totalCostUsd, counted, pending, runs } = await createCostRoller(memory).rollup();
  approx(totalCostUsd, 2.1893222); // 0 + 0.2206877 + 1.9686345
  assert.equal(counted, 3);
  assert.equal(pending, 0);
  const worker = runs.find((r) => r.runId.startsWith('worker-'));
  approx(worker.costUsd, 1.9686345);
});

test('§8: cost comes from the final result, not per-message tokens', async () => {
  // Precondition — this real fixture has the divergence the rule exists for: per-message
  // output_tokens sum (135) is ~7x under the final total (956).
  const raw = await memory.readTranscript(REVIEWER);
  let perMsg = 0;
  for (const l of raw.split('\n').filter(Boolean)) {
    let o;
    try { o = JSON.parse(l); } catch { continue; }
    if (o.type === 'assistant' && o.message?.usage) perMsg += o.message.usage.output_tokens || 0;
  }
  assert.equal(perMsg, 135, 'per-message sum diverges from the final total');
  // We report the authoritative final figure regardless of that divergence.
  assert.equal(finalCost(raw), 0.2206877);
});

test('finalCost takes the terminal result, never an earlier one', () => {
  // Synthetic: an early result then a later (final) one — cost must be the last.
  const raw = [
    '{"type":"system","subtype":"init","model":"m","session_id":"s"}',
    '{"type":"result","subtype":"success","total_cost_usd":0.01}',
    '{"type":"assistant","message":{"content":[{"type":"text","text":"more"}]}}',
    '{"type":"result","subtype":"success","total_cost_usd":0.5}',
  ].join('\n');
  assert.equal(finalCost(raw), 0.5);
});

test('a run with no final result contributes nothing (cost unavailable, not 0)', () => {
  assert.equal(finalCost(fs.readFileSync(INCOMPLETE, 'utf8')), null);
});

test('a terminal result with no cost reports null, not a stale earlier cost', () => {
  // Synthetic: a cost-bearing result followed by a terminal error result with no
  // total_cost_usd. Cost is keyed on the LAST result, so the answer is "unavailable".
  const raw = [
    '{"type":"result","subtype":"success","total_cost_usd":0.01}',
    '{"type":"assistant","message":{"content":[{"type":"text","text":"resumed"}]}}',
    '{"type":"result","subtype":"error","is_error":true}',
  ].join('\n');
  assert.equal(finalCost(raw), null);
});

test('rollup is cached by mtime: unchanged files are not re-read', async () => {
  const mtimes = { a: 100, b: 200 };
  const transcripts = {
    a: '{"type":"result","total_cost_usd":1}',
    b: '{"type":"result","total_cost_usd":2}',
  };
  let reads = 0;
  const src = {
    async listLogs() {
      return Object.keys(transcripts).map((runId) => ({ runId, mtime: mtimes[runId], size: 1 }));
    },
    async readTranscript(runId) {
      reads += 1;
      return transcripts[runId];
    },
  };
  const roller = createCostRoller(src);

  const first = await roller.rollup();
  approx(first.totalCostUsd, 3);
  assert.equal(reads, 2, 'both files read on the cold pass');

  await roller.rollup();
  assert.equal(reads, 2, 'second pass is all cache hits — no re-reads');

  mtimes.b = 201; // b changed on disk
  await roller.rollup();
  assert.equal(reads, 3, 'only the changed file is re-read');
});

test('null mtime is never cached (recomputed each pass)', async () => {
  let reads = 0;
  const src = {
    async listLogs() { return [{ runId: 'a', mtime: null, size: 1 }]; },
    async readTranscript() { reads += 1; return '{"type":"result","total_cost_usd":1}'; },
  };
  const roller = createCostRoller(src);
  await roller.rollup();
  await roller.rollup();
  assert.equal(reads, 2, 'a null mtime forces recompute rather than trusting a stale cache');
});
