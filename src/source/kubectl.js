'use strict';

const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { assertRunId } = require('../runid');
const { parseLogList, parseWorkdirs } = require('./parse');

// Live backend: implements the seam over a kubeconfig with `kubectl exec`/`kubectl logs`.
// Read-only — it never mutates the cluster (DESIGN §1). Cluster-dependent, so it is not
// unit-tested; its pure parsers (./parse) and runId guard (../runid) are tested offline,
// and the in-memory backend proves the seam contract.

function createKubectlSource(opts = {}) {
  const cfg = {
    context: opts.context || process.env.CONTEXT || 'k3d-plat',
    namespace: opts.namespace || process.env.NAMESPACE || 'agents',
    deploy: opts.deploy || process.env.DEPLOY || 'agents',
    logdir: opts.logdir || process.env.LOGDIR || '/data/logs',
    workdir: opts.workdir || process.env.WORKDIR || '/data/work',
    port: opts.healthzPort || process.env.HEALTHZ_PORT || '9909',
    tail: opts.tail || Number.parseInt(process.env.TAIL || '400', 10),
  };
  const kbase = ['--context', cfg.context, '-n', cfg.namespace];

  // Run kubectl to completion, collecting stdout as a string. No maxBuffer cap —
  // transcripts can be multiple MB.
  function run(args) {
    return new Promise((resolve, reject) => {
      const child = spawn('kubectl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const out = [];
      const err = [];
      child.stdout.on('data', (c) => out.push(c));
      child.stderr.on('data', (c) => err.push(c));
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) return resolve(Buffer.concat(out).toString('utf8'));
        reject(new Error(`kubectl ${args.join(' ')} exited ${code}: ${Buffer.concat(err).toString('utf8').trim()}`));
      });
    });
  }

  // Run a shell command inside the agents pod.
  function podSh(script) {
    return run([...kbase, 'exec', `deploy/${cfg.deploy}`, '--', 'sh', '-c', script]);
  }

  async function healthz() {
    const j = JSON.parse(await podSh(`curl -s localhost:${cfg.port}/healthz`));
    return { ok: !!j.ok, activeRuns: j.activeRuns | 0, queued: j.queued | 0 };
  }

  async function listLogs() {
    const out = await podSh(`find ${cfg.logdir} -maxdepth 1 -name '*.log' -printf '%f\\t%s\\t%T@\\n'`);
    return parseLogList(out);
  }

  async function readTranscript(runId) {
    assertRunId(runId);
    return podSh(`cat ${cfg.logdir}/${runId}.log`);
  }

  async function scanWorkdirs() {
    const out = await podSh(`find ${cfg.workdir} -maxdepth 1 -mindepth 1 -printf '%f %T@\\n'`);
    return parseWorkdirs(out);
  }

  // `kubectl logs -f` follows the dispatcher's stdout; readline turns it into lines.
  function tailDispatcherLog() {
    const child = spawn(
      'kubectl',
      [...kbase, 'logs', `deploy/${cfg.deploy}`, '-f', `--tail=${cfg.tail}`],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    return {
      lines,
      close() {
        lines.close();
        child.kill();
      },
    };
  }

  return { healthz, listLogs, readTranscript, scanWorkdirs, tailDispatcherLog };
}

module.exports = { createKubectlSource };
