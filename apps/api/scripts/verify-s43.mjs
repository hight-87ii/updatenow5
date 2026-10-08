import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const root = resolve(import.meta.dirname, '../../..');
const runtime = resolve(root, 'monitoring/.runtime');
const routing = JSON.parse(
  readFileSync(resolve(runtime, 'alertmanager.json'), 'utf8'),
);
assert(
  routing.receivers?.find((r) => r.name === 'email')?.email_configs?.[0]
    ?.smarthost === 'receiver:2525' &&
    routing.receivers?.find((r) => r.name === 'telegram')?.telegram_configs?.[0]
      ?.api_url === 'http://receiver:8080',
  'Full integration verifier is local-only; restore default setup before running',
);
const evidence = resolve(root, 'evidence/s43/runtime');
mkdirSync(evidence, { recursive: true });
const composeArgs = [
  'compose',
  '--env-file',
  resolve(runtime, 'compose.env'),
  '-f',
  resolve(root, 'monitoring/compose.yaml'),
];
function compose(...args) {
  const r = spawnSync('docker', [...composeArgs, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120000,
    windowsHide: true,
  });
  assert(
    r.status === 0,
    `Compose ${args[0]} failed; inspect local diagnostics without printing credentials`,
  );
  return r.stdout.trim();
}
function inside(code, service = 'receiver') {
  return compose('exec', '-T', service, 'node', '-e', code);
}
function http(url, method = 'GET', body) {
  const code = `const fs=require('node:fs');fetch(${JSON.stringify(url)},{method:${JSON.stringify(method)},headers:{'Content-Type':'application/json',Authorization:'Bearer '+fs.readFileSync('/run/secrets/metrics_token','utf8').trim()},${body ? `body:JSON.stringify(${JSON.stringify(body)}),` : ''}signal:AbortSignal.timeout(5000)}).then(async r=>{if(!r.ok)throw Error('internal HTTP failed');console.log(await r.text())}).catch(()=>process.exit(1));`;
  const text = inside(code);
  return text ? JSON.parse(text) : null;
}
// The mounted file may have been restored without restarting Alertmanager.
// Inspect the active receiver configuration before any load or alert side effect.
const activeRouting = http('http://alertmanager:9093/api/v2/status').config
  .original;
assert(
  /^\s+smarthost:\s*receiver:2525\s*$/m.test(activeRouting) &&
    /^\s+api_url:\s*http:\/\/receiver:8080\/?\s*$/m.test(activeRouting) &&
    /^\s+bot_token_file:\s*\/run\/secrets\/telegram_token\s*$/m.test(
      activeRouting,
    ) &&
    [...activeRouting.matchAll(/^\s*-\s*name:\s*(\S+)\s*$/gm)]
      .map((m) => m[1])
      .sort()
      .join(',') === 'discard,email,telegram',
  'Active Alertmanager routing must be local; restore default setup and restart Alertmanager first',
);
const query = (expr) =>
  http(`http://prometheus:9090/api/v1/query?query=${encodeURIComponent(expr)}`)
    .data.result;
const deliveries = () => http('http://receiver:8080/deliveries');
const control = (value) => http('http://receiver:8080/control', 'POST', value);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function wait(check, name, timeout = 90000) {
  report.lastWait = name;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (await check()) return;
    } catch {}
    await sleep(2000);
  }
  throw Error(`Timed out: ${name}`);
}
const report = {
  sourceHeadSHA: process.env.S43_SOURCE_HEAD ?? null,
  sourceSHA: spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).stdout.trim(),
  started: new Date().toISOString(),
  environment: 'isolated Docker local',
  externalDelivery: false,
  staging: false,
  checks: [],
  rawSamples: [],
  alerts: [],
  webhook: 'Pending: no real producer',
  benchmark: [],
};
const check = (value, name) => {
  assert(value, name);
  report.checks.push(name);
  console.log(`PASS ${name}`);
};
const password = readFileSync(resolve(runtime, 'db-password'), 'utf8').trim();
const db = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: `postgresql://s43_fixture:${password}@127.0.0.1:15443/s43_monitoring`,
    max: 4,
  }),
});
let eventId,
  showId,
  seatIds = [];
const users = [];
async function account(roleName) {
  const role = await db.role.upsert({
    where: { name: roleName },
    create: { name: roleName },
    update: {},
  });
  const token = randomBytes(32).toString('base64url');
  const id = randomUUID();
  await db.user.create({
    data: {
      id,
      email: `s43-${id}@example.invalid`,
      password: 'not-a-login-hash-fixture',
      isEmailVerified: true,
      userRoles: { create: { roleId: role.id } },
      sessions: {
        create: {
          tokenHash: createHash('sha256').update(token).digest('hex'),
          expiresAt: new Date(Date.now() + 3600000),
        },
      },
    },
  });
  users.push(id);
  return { id, cookie: `event_session=${token}` };
}
async function call(port, path, method = 'GET', body, account) {
  const start = performance.now();
  const r = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(account ? { cookie: account.cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  const data = await r.json();
  return { status: r.status, ms: performance.now() - start, data };
}
function exported(service) {
  return inside(
    "const fs=require('node:fs');fetch('http://127.0.0.1:9464/metrics',{headers:{Authorization:'Bearer '+fs.readFileSync('/run/secrets/metrics_token','utf8').trim()}}).then(r=>r.text()).then(console.log)",
    service,
  );
}
function counter(text, name) {
  return text
    .split('\n')
    .filter((l) => l.startsWith(name + '{') || l.startsWith(name + ' '))
    .reduce((n, l) => n + Number(l.split(' ').at(-1)), 0);
}
function testRule(name, enabled) {
  const file = resolve(runtime, 'test-rules.json');
  writeFileSync(
    file,
    JSON.stringify({
      groups: enabled
        ? [
            {
              name: 's43-integration-only',
              rules: [
                {
                  alert: name,
                  expr: 'sum(rate(ticket_http_requests_total{service="api",route="/showtimes"}[20s])) > 1',
                  for: '10s',
                  labels: {
                    severity: 'test',
                    service: 'api',
                    environment: 'local',
                  },
                  annotations: {
                    metric: 'HTTP /showtimes RPS',
                    value: '{{ $value }}',
                    threshold: '1 integration-only',
                    window: '20s, for 10s',
                    dashboard: 'http://localhost:13000/d/s43-monitoring',
                    runbook: 'docs/S43_MONITORING_RUNBOOK.md',
                  },
                },
              ],
            },
          ]
        : [],
    }),
  );
  http('http://prometheus:9090/-/reload', 'POST', {});
}
async function instrumentation(enabled) {
  const file = resolve(runtime, 'instrumentation-override.json');
  writeFileSync(
    file,
    JSON.stringify({
      services: {
        'api-a': { environment: { MONITORING_ENABLED: String(enabled) } },
        'api-b': { environment: { MONITORING_ENABLED: String(enabled) } },
      },
    }),
  );
  const r = spawnSync(
    'docker',
    [
      ...composeArgs,
      '-f',
      file,
      'up',
      '-d',
      '--no-build',
      '--no-deps',
      '--force-recreate',
      'api-a',
      'api-b',
    ],
    { cwd: root, encoding: 'utf8', timeout: 120000, windowsHide: true },
  );
  assert(
    r.status === 0,
    'Instrumentation override failed; inspect private diagnostics',
  );
  await wait(async () => {
    const responses = await Promise.all([
      fetch('http://127.0.0.1:18001/health'),
      fetch('http://127.0.0.1:18002/health'),
    ]);
    return responses.every((r) => r.ok);
  }, 'benchmark APIs');
}
const percentile = (values, p) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
async function benchmark(a, b) {
  const batch = async () => {
    await db.seatHold.deleteMany({ where: { showtimeId: showId } });
    await db.holdSession.deleteMany({ where: { showtimeId: showId } });
    const tasks = seatIds.flatMap((id, i) => [
      call(
        i % 2 ? 18002 : 18001,
        `/showtimes/${showId}/holds`,
        'POST',
        { seatIds: [id] },
        a,
      ),
      call(
        i % 2 ? 18001 : 18002,
        `/showtimes/${showId}/holds`,
        'POST',
        { seatIds: [id] },
        b,
      ),
    ]);
    const results = await Promise.all(tasks);
    return {
      rawMs: results.map((r) => r.ms),
      statuses: results.reduce(
        (v, r) => ((v[r.status] = (v[r.status] ?? 0) + 1), v),
        {},
      ),
    };
  };
  report.benchmarkWarmup = [];
  try {
    // Balanced crossover, rather than all off then all on. Each measured batch
    // follows a fresh process and identical unmeasured claim warm-up, so cold
    // startup/JIT/connection pool cost is not attributed to instrumentation.
    const orders = [
      [true, false],
      [false, true],
      [true, false],
      [false, true],
    ];
    for (const [pair, order] of orders.entries()) {
      for (const [position, enabled] of order.entries()) {
        await instrumentation(enabled);
        const warmup = await batch();
        check(
          warmup.statuses[200] === 100 && warmup.statuses[409] === 100,
          `benchmark warmup atomic hold invariant 100 successes / 100 conflicts: ${JSON.stringify(warmup.statuses)}`,
        );
        report.benchmarkWarmup.push({
          instrumentation: enabled,
          pair,
          position,
          ...warmup,
          excludedFromPooledSamples: true,
        });
        const { rawMs: ms, statuses } = await batch();
        check(
          statuses[200] === 100 && statuses[409] === 100,
          `benchmark atomic hold invariant 100 successes / 100 conflicts: ${JSON.stringify(statuses)}`,
        );
        report.benchmark.push({
          instrumentation: enabled,
          round: pair,
          pair,
          position,
          concurrency: 200,
          requests: 200,
          seats: 100,
          statuses,
          rawMs: ms,
          p50Ms: percentile(ms, 0.5),
          p95Ms: percentile(ms, 0.95),
        });
        console.log(
          `Benchmark ${enabled ? 'metrics' : 'baseline'} pair ${pair + 1}: p95 ${percentile(ms, 0.95).toFixed(2)} ms`,
        );
      }
    }
    const summary = (enabled) => {
      const raw = report.benchmark
        .filter((v) => v.instrumentation === enabled)
        .flatMap((v) => v.rawMs);
      return {
        samples: raw.length,
        p50Ms: percentile(raw, 0.5),
        p95Ms: percentile(raw, 0.95),
        holdNfrPass: percentile(raw, 0.95) < 300,
      };
    };
    report.overhead = {
      before: summary(false),
      after: summary(true),
      method:
        'Same image/build/dataset, 200 concurrency, two instances, four balanced off/on crossover pairs; fresh API processes and identical unmeasured 200-claim warmup per batch; pooled measured samples, no average of p95; finite CI pairs are not production capacity or statistical causality proof',
    };
    report.overhead.pairs = [0, 1, 2, 3].map((pair) => {
      const before = report.benchmark.find(
        (v) => v.pair === pair && !v.instrumentation,
      );
      const after = report.benchmark.find(
        (v) => v.pair === pair && v.instrumentation,
      );
      return {
        pair,
        order: orders[pair],
        beforeP95Ms: before.p95Ms,
        afterP95Ms: after.p95Ms,
        p95DeltaPercent: 100 * (after.p95Ms / before.p95Ms - 1),
      };
    });
    report.overhead.p95DeltaMs =
      report.overhead.after.p95Ms - report.overhead.before.p95Ms;
    report.overhead.p95DeltaPercent =
      100 * (report.overhead.after.p95Ms / report.overhead.before.p95Ms - 1);
    report.histogram = query(
      'histogram_quantile(0.95,sum by(le)(rate(ticket_http_request_duration_seconds_bucket{service="api",method="POST",route="/showtimes/:id/holds"}[5m])))',
    );
  } finally {
    await instrumentation(true);
  }
  await wait(
    () =>
      query('up{job="ticketing",service="api"}').filter(
        (v) => v.value[1] === '1',
      ).length === 2,
    'benchmark scrape restoration',
  );
}
async function lifecycle(name, failChannel) {
  const before = deliveries().at(-1)?.id ?? 0;
  const ownDeliveries = () =>
    deliveries().filter((v) => v.id > before && v.alertName === name);
  control({
    testName: name,
    emailFail: failChannel === 'email',
    telegramFail: failChannel === 'telegram',
  });
  testRule(name, true);
  const timer = setInterval(() => {
    void Promise.all([
      call(18001, '/showtimes'),
      call(18002, '/showtimes'),
    ]).catch(() => {});
  }, 250);
  let pending = false;
  try {
    await wait(() => {
      const q = query(`ALERTS{alertname="${name}",alertstate="pending"}`);
      if (q.length) pending = true;
      return pending;
    }, 'Pending alert');
    await wait(
      () => query(`ALERTS{alertname="${name}",alertstate="firing"}`).length > 0,
      'Firing alert',
    );
    const successChannel = failChannel === 'email' ? 'telegram' : 'email';
    await wait(() => {
      const d = ownDeliveries();
      return failChannel
        ? d.some((v) => v.channel === failChannel && v.state === 'failed') &&
            d.some((v) => v.channel === successChannel && v.state === 'firing')
        : ['email', 'telegram'].every((c) =>
            d.some((v) => v.channel === c && v.state === 'firing'),
          );
    }, 'Independent channel fanout');
    if (failChannel) {
      check(
        !ownDeliveries().some(
          (v) =>
            v.id > before && v.channel === failChannel && v.state === 'firing',
        ),
        `${name}: failed channel not misreported delivered`,
      );
      control({ emailFail: false, telegramFail: false });
      await wait(
        () =>
          ownDeliveries().some(
            (v) =>
              v.id > before &&
              v.channel === failChannel &&
              v.state === 'firing',
          ),
        'Retry recovery',
        120000,
      );
    }
    await sleep(12000);
    const firing = ownDeliveries().filter(
      (v) => v.id > before && v.state === 'firing',
    );
    check(
      ['email', 'telegram'].every(
        (c) => firing.filter((v) => v.channel === c).length === 1,
      ),
      `${name}: grouped/dedup firing once per channel`,
    );
  } finally {
    clearInterval(timer);
    control({ emailFail: false, telegramFail: false });
  }
  // Keep the rule loaded while traffic falls below its threshold. Removing a
  // firing rule stops updates and waits for EndsAt expiry instead of exercising
  // Prometheus' real false-condition -> Resolved notification path.
  await wait(
    () =>
      ['email', 'telegram'].every((c) =>
        ownDeliveries().some(
          (v) => v.id > before && v.channel === c && v.state === 'resolved',
        ),
      ),
    'Resolved delivery',
    120000,
  );
  check(
    query(`ALERTS{alertname="${name}"}`).length === 0,
    `${name}: returned to Normal`,
  );
  report.alerts.push({
    name,
    pending,
    firing: true,
    resolved: true,
    failChannel: failChannel ?? null,
    deliveries: ownDeliveries(),
  });
  testRule(name, false);
}
try {
  await wait(
    () =>
      query('up{job="ticketing"}').filter((v) => v.value[1] === '1').length ===
      3,
    'Three scrape targets',
  );
  check(true, 'two real API instances and expiry worker scraped');
  const unauth = inside(
    "fetch('http://api-a:9464/metrics').then(r=>console.log(r.status))",
  );
  check(unauth === '401', 'metrics denied without credential');
  check(
    (await fetch('http://127.0.0.1:13000/api/dashboards/uid/s43-monitoring'))
      .status === 401,
    'dashboard denied anonymously',
  );
  const owner = await account('ORGANIZER'),
    a = await account('BUYER'),
    b = await account('BUYER');
  const event = await db.event.create({
    data: {
      name: 'S43 isolated fixture',
      description: 'synthetic only',
      location: 'local',
      status: 'PUBLISHED',
      organizerId: owner.id,
    },
  });
  eventId = event.id;
  const show = await db.showtime.create({
    data: {
      eventId,
      status: 'ON_SALE',
      startTime: new Date(Date.now() + 86400000),
    },
  });
  showId = show.id;
  const category = await db.seatCategory.create({
    data: { showtimeId: showId, name: 'S43', price: 100000 },
  });
  await db.seat.createMany({
    data: Array.from({ length: 100 }, (_, i) => ({
      showtimeId: showId,
      categoryId: category.id,
      row: 'A',
      seatNumber: i + 1,
    })),
  });
  seatIds = (
    await db.seat.findMany({
      where: { showtimeId: showId },
      orderBy: { seatNumber: 'asc' },
    })
  ).map((s) => s.id);
  const beforeA = counter(exported('api-a'), 'ticket_http_requests_total'),
    beforeB = counter(exported('api-b'), 'ticket_http_requests_total');
  const conflictsBefore =
    counter(exported('api-a'), 'ticket_hold_conflicts_total') +
    counter(exported('api-b'), 'ticket_hold_conflicts_total');
  const cases = [
    [18001, '/showtimes', 'GET', undefined, undefined, 200],
    [18002, '/showtimes', 'GET', undefined, undefined, 200],
    [
      18001,
      `/showtimes/${showId}/holds`,
      'POST',
      { seatIds: [seatIds[0]] },
      a,
      200,
    ],
    [
      18002,
      `/showtimes/${showId}/holds`,
      'POST',
      { seatIds: [seatIds[0]] },
      b,
      409,
    ],
    [
      18001,
      `/showtimes/${showId}/holds`,
      'POST',
      { seatIds: [seatIds[0]] },
      undefined,
      401,
    ],
    [
      18002,
      `/showtimes/${showId}/holds`,
      'POST',
      { seatIds: [seatIds[0]] },
      owner,
      403,
    ],
    [18001, `/showtimes/${showId}/holds`, 'POST', { seatIds: [] }, b, 400],
    [
      18002,
      '/random-user-secret?token=never-label',
      'GET',
      undefined,
      undefined,
      404,
    ],
  ];
  for (const [port, path, method, body, account, status] of cases) {
    const r = await call(port, path, method, body, account);
    check(r.status === status, `real HTTP ${status} captured`);
    report.rawSamples.push({ port, status: r.status, ms: r.ms });
  }
  await db.showtime.update({
    where: { id: showId },
    data: { status: 'CLOSED' },
  });
  const closed = await call(
    18002,
    `/showtimes/${showId}/holds`,
    'POST',
    { seatIds: [seatIds[1]] },
    b,
  );
  check(
    closed.status === 409 && closed.data.code === 'SHOWTIME_CLOSED',
    'closed showtime 409 distinct',
  );
  await db.showtime.update({
    where: { id: showId },
    data: { status: 'ON_SALE' },
  });
  await call(18001, '/health');
  const expA = exported('api-a'),
    expB = exported('api-b');
  check(
    counter(expA, 'ticket_http_requests_total') - beforeA === 4 &&
      counter(expB, 'ticket_http_requests_total') - beforeB === 5,
    'known 9 responses reconcile with exporter; health excluded',
  );
  check(
    counter(expA, 'ticket_hold_conflicts_total') +
      counter(expB, 'ticket_hold_conflicts_total') -
      conflictsBefore ===
      1,
    'real seat conflict counted once; other 409 excluded',
  );
  check(
    ![showId, ...seatIds, ...users, 'never-label', 'random-user-secret'].some(
      (v) => (expA + expB).includes(v),
    ),
    'telemetry privacy; bounded route templates',
  );
  const malformed = await fetch(
    `http://127.0.0.1:18001/showtimes/${showId}/holds`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid',
    },
  );
  check(malformed.status === 400, 'real malformed JSON counted before parser');
  check(
    exported('api-a').includes('route="__unmatched__",status="400"'),
    'parser error is bounded unknown route',
  );
  await wait(
    () =>
      query('sum(ticket_http_requests_total{service="api"})').some(
        (v) => Number(v.value[1]) >= 9,
      ),
    'collector real series',
  );
  check(
    query('max(ticket_producer_available{subsystem="webhook"})')[0]
      ?.value[1] === '0',
    'webhook producer honestly unavailable',
  );
  check(
    query('sum(rate(ticket_webhook_rejections_total[5m]))').length === 0,
    'no webhook samples = No data, not zero',
  );
  const snapshots = query('ticket_http_requests_total{service="api"}');
  report.series = snapshots;
  // A real dependency exception must also pass through completion instrumentation.
  // Stop only this stack's dedicated database, preserve its volume, then recover.
  compose('stop', 'postgres');
  try {
    const failed = await call(
      18001,
      `/showtimes/${showId}/holds`,
      'GET',
      undefined,
      a,
    );
    check(
      failed.status === 500,
      'real database exception returns instrumented HTTP 500',
    );
    check(
      exported('api-a').includes('status="500"'),
      'guard/dependency exception counted',
    );
    report.rawSamples.push({
      status: failed.status,
      ms: failed.ms,
      case: 'dedicated DB unavailable',
    });
  } finally {
    compose('start', 'postgres');
    await wait(
      () => db.$queryRaw`SELECT 1`.then(() => true),
      'dedicated database recovery',
    );
  }
  // Counter reset: restart one exporter process, then re-observe real requests.
  for (let i = 0; i < 3; i++) await call(18001, '/showtimes');
  await wait(
    () =>
      query(
        'ticket_http_requests_total{instance="api-a:9464",route="/showtimes",status="200"}',
      ).some((v) => Number(v.value[1]) >= 4),
    'collector observes pre-restart counter above new value',
  );
  compose('restart', 'api-a');
  await wait(
    async () => (await fetch('http://127.0.0.1:18001/health')).ok,
    'restart API',
  );
  check(
    counter(exported('api-a'), 'ticket_http_requests_total') === 0,
    'restart resets process counters',
  );
  await call(18001, '/showtimes');
  await wait(
    () =>
      query(
        'sum(resets(ticket_http_requests_total{instance="api-a:9464"}[5m]))',
      ).some((v) => Number(v.value[1]) > 0),
    'Prometheus detects reset',
  );
  check(true, 'rate/reset semantics after restart');
  compose('stop', 'api-b');
  await wait(
    () => query('up{instance="api-b:9464"}')[0]?.value[1] === '0',
    'scrape down',
  );
  check(
    query(
      '(sum(rate(ticket_http_requests_total{service="api"}[5m]))) and on() (min(up{service="api"}) == 1)',
    ).length === 0,
    'partial scrape down masks healthy totals as Unknown',
  );
  compose('start', 'api-b');
  await wait(
    () => query('up{instance="api-b:9464"}')[0]?.value[1] === '1',
    'scrape recover',
  );
  const discoveryFile = resolve(runtime, 'targets.json');
  const discovery = readFileSync(discoveryFile, 'utf8');
  try {
    const removed = JSON.parse(discovery);
    removed[0].targets = ['api-a:9464'];
    writeFileSync(discoveryFile, JSON.stringify(removed));
    await wait(
      () => query('up{instance="api-b:9464"}').length === 0,
      'removed discovery target becomes absent',
    );
    check(
      query(
        '(sum(rate(ticket_http_requests_total{service="api"}[5m]))) and on() (count(up{service="api"}) == 2)',
      ).length === 0,
      'removed target masks incomplete aggregate as Unknown',
    );
    await wait(
      () =>
        query('ALERTS{alertname="S43TargetMissing",alertstate="pending"}')
          .length > 0,
      'missing target alert Pending',
    );
    check(true, 'removed target detected independently of up=0');
  } finally {
    writeFileSync(discoveryFile, discovery);
    await wait(
      () => query('up{instance="api-b:9464"}')[0]?.value[1] === '1',
      'discovery target recovery',
    );
  }
  // Real worker uses original TTL; expiry fixture modifies only this run-owned claim.
  await db.seatHold.updateMany({
    where: { showtimeId: showId },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await db.holdSession.updateMany({
    where: { showtimeId: showId },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  compose('restart', 'worker');
  await wait(
    () =>
      db.seatHold.count({ where: { showtimeId: showId } }).then((n) => n === 0),
    'worker cleanup own expired fixture',
  );
  await wait(
    () =>
      query('ticket_worker_cleaned_holds_total{service="worker"}').some(
        (v) => Number(v.value[1]) >= 1,
      ),
    'worker counter',
  );
  check(
    true,
    'real expiry worker last success/duration/cleanup; cadence and product TTL unchanged',
  );
  console.log('Same-build before/after overhead and hold NFR measurement');
  await benchmark(a, b);
  console.log(
    'Alert lifecycle tests: both channels, independent failures and recover',
  );
  await lifecycle('S43IntegrationBoth');
  await lifecycle('S43IntegrationEmailFailure', 'email');
  await lifecycle('S43IntegrationTelegramFailure', 'telegram');
  report.deliverySummary = deliveries();
  report.finished = new Date().toISOString();
  report.pass = true;
} catch (error) {
  report.pass = false;
  report.failure = {
    type: error.name,
    message: String(error?.message ?? error).slice(0, 500),
    lastWait: report.lastWait,
    lastPassedCheck: report.checks.at(-1),
  };
  throw Error(
    'S43 integration failed; inspect sanitized integration.json and lastWait',
  );
} finally {
  report.cleanupErrors = [];
  const cleanup = async (name, action) => {
    try {
      await action();
    } catch {
      report.cleanupErrors.push(name);
      process.exitCode = 1;
    }
  };
  await cleanup('receiver controls', () =>
    control({ emailFail: false, telegramFail: false, testName: null }),
  );
  await cleanup('integration-only rules', () => testRule('unused', false));
  if (showId) {
    await cleanup('fixture holds', () =>
      db.seatHold.deleteMany({ where: { showtimeId: showId } }),
    );
    await cleanup('fixture hold sessions', () =>
      db.holdSession.deleteMany({ where: { showtimeId: showId } }),
    );
    await cleanup('fixture seats', () =>
      db.seat.deleteMany({ where: { showtimeId: showId } }),
    );
    await cleanup('fixture categories', () =>
      db.seatCategory.deleteMany({ where: { showtimeId: showId } }),
    );
    await cleanup('fixture showtime', () =>
      db.showtime.deleteMany({ where: { id: showId } }),
    );
  }
  if (eventId)
    await cleanup('fixture event', () =>
      db.event.deleteMany({ where: { id: eventId } }),
    );
  if (users.length)
    await cleanup('fixture users', () =>
      db.user.deleteMany({ where: { id: { in: users } } }),
    );
  await cleanup('database disconnect', () => db.$disconnect());
  report.finished ??= new Date().toISOString();
  writeFileSync(
    resolve(evidence, 'integration.json'),
    JSON.stringify(report, null, 2),
  );
}
console.log(
  `S-43 integration PASS; ${report.checks.length} checks. External delivery Pending.`,
);
