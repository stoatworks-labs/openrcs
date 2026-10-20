// node crates/openrcs-server/web/awj-hold.test.mjs — the preview hold, with a fake clock and no device.
import assert from 'node:assert/strict';
import { takeTarget, statusTarget, createTakeGuard, createCueQueue, START_GRACE_MS, HOLD_GRACE_MS, POLL_MS, FRESH_MS } from './awj-hold.js';

// ---- spellings: both object models, screens and auxiliaries
assert.equal(takeTarget('DeviceObject/transition/$screen/@items/1/control/@props/xTake', true), 'S1');
assert.equal(takeTarget('DeviceObject/transition/$auxiliaryScreen/@items/3/control/@props/xTake', true), 'A3');
assert.equal(takeTarget('DeviceObject/$screenAuxGroup/@items/S2/control/@props/xTake', true), 'S2');
assert.equal(takeTarget('DeviceObject/$screenAuxGroup/@items/S2/control/@props/xTakeUp', true), 'S2');
assert.equal(takeTarget('DeviceObject/transition/$screen/@items/1/control/@props/xCut', true), null, 'a cut has no window');
assert.equal(takeTarget('DeviceObject/transition/$screen/@items/1/control/@props/xTake', false), null);
assert.equal(takeTarget('DeviceObject/transition/$screen/@items/1/control/@props/takeTime', true), null);
assert.equal(statusTarget('DeviceObject/transition/$screen/@items/2/status/@props/transition'), 'S2');
assert.equal(statusTarget('DeviceObject/transition/$auxiliaryScreen/@items/1/status/@props/transition'), 'A1');
assert.equal(statusTarget('DeviceObject/$screenAuxGroup/@items/S1/status/@props/transition'), 'S1');
assert.equal(statusTarget('DeviceObject/$screenAuxGroup/@items/S1/status/@props/take'), 'S1');
assert.equal(statusTarget('DeviceObject/transition/$screen/@items/1/status/@props/tbarPosition'), null);
assert.equal(statusTarget('DeviceObject/$screen/@items/1/$preset/@items/UP/status/@props/memoryId'), null);

// ---- a clock that only moves when told, with the microtasks run between timers
function fakeClock() {
  let t = 0, seq = 0;
  const timers = new Map();
  const add = (fn, ms, every) => { const id = ++seq; timers.set(id, { at: t + Math.max(0, ms), fn, every }); return id; };
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  return {
    now: () => t,
    setTimeout: (fn, ms) => add(fn, ms, 0),
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, ms) => add(fn, ms, ms),
    clearInterval: (id) => timers.delete(id),
    pending: () => timers.size,
    async advance(ms) {
      const end = t + ms;
      await flush();
      for (;;) {
        let next = null;
        for (const [id, x] of timers) if (x.at <= end && (!next || x.at < next[1].at || (x.at === next[1].at && id < next[0]))) next = [id, x];
        if (!next) break;
        const [id, x] = next;
        t = x.at;
        if (x.every) x.at += x.every; else timers.delete(id);
        x.fn();
        await flush();
      }
      t = end;
      await flush();
    },
  };
}

// ---- a pretend processor: one take time per destination, pushes its state changes.
// It keeps which memory each buffer holds and resolves PREVIEW and PROGRAM the
// way the simulators do, by the transition's suffix: mid-take, program is the
// buffer leaving air and preview the one arriving.
function fakeDevice(clock, { takeMs = 3000, pushes = true } = {}) {
  const st = new Map();          // id -> { transition, moving }
  const times = new Map();
  const bufs = new Map();        // id -> { UP, DOWN }: the memory each buffer holds
  const log = [];
  let guard = null;
  const set = (id, v) => { st.set(id, v); if (pushes && guard) guard.saw(`DeviceObject/transition/$screen/@items/${id.slice(1)}/status/@props/transition`); };
  const side = (id, to) => {
    const pgm = (st.get(id)?.transition || 'AT_DOWN').endsWith('UP') ? 'UP' : 'DOWN';
    return to === 'PROGRAM' ? pgm : pgm === 'UP' ? 'DOWN' : 'UP';
  };
  const dev = {
    log, st,
    attach(g) { guard = g; },
    state: (id) => st.get(id) || {},
    takeMs: (id) => times.get(id) ?? takeMs,
    setTakeMs: (id, v) => times.set(id, v),
    rest(id, at = 'AT_DOWN') { st.set(id, { transition: at, moving: false }); },
    // The take: in flight at once, landed at the other end after the take time
    // — unless parked, which is a T-bar left half way.
    take(id, { parked = false, refuse = false } = {}) {
      log.push(`take ${id}`);
      guard && guard.sent(`DeviceObject/transition/$screen/@items/${id.slice(1)}/control/@props/xTake`, true);
      if (refuse) return;
      const from = st.get(id).transition;
      const to = from === 'AT_DOWN' ? 'AT_UP' : 'AT_DOWN';
      clock.setTimeout(() => set(id, { transition: `EFFECT_FROM_${from.slice(3)}`, moving: true }), 5);
      if (!parked) clock.setTimeout(() => set(id, { transition: to, moving: false }), dev.takeMs(id));
    },
    recall(id, slot, to = 'PREVIEW') {
      log.push(`recall ${id} M${slot}${to === 'PROGRAM' ? ' to program' : ''}`);
      bufs.set(id, { ...bufs.get(id), [side(id, to)]: slot });
    },
    /** The memories on program and preview now. */
    onAir(id) { const b = bufs.get(id) || {}; return { program: b[side(id, 'PROGRAM')], preview: b[side(id, 'PREVIEW')] }; },
  };
  return dev;
}

function rig(opts = {}) {
  const clock = fakeClock();
  const dev = fakeDevice(clock, opts);
  const polls = [];
  const guard = createTakeGuard({
    state: dev.state, takeMs: dev.takeMs, clock,
    // A poll is a read: with live updates off it is how the guard learns anything.
    poll: (id) => { polls.push(id); if (!opts.pushes && opts.pushes !== undefined) guard.saw(`DeviceObject/transition/$screen/@items/${id.slice(1)}/status/@props/transition`); },
  });
  dev.attach(guard);
  return { clock, dev, guard, polls };
}

// ---- nothing in flight: send now
{
  const { dev, guard } = rig();
  dev.rest('S1');
  assert.equal(guard.whenSettled(['S1']), null);
  assert.equal(guard.whenSettled([]), null);
}

// ---- a take this page sent holds a recall until it lands, then lets it go
{
  const { clock, dev, guard } = rig();
  dev.rest('S1');
  dev.take('S1');
  assert.ok(guard.isGuarded('S1'));
  await clock.advance(600);
  const p = guard.whenSettled(['S1']);
  assert.ok(p, 'held mid-take');
  let r = null; p.then((x) => { r = x; });
  await clock.advance(2000);
  assert.equal(r, null, 'still in flight at 2.6 s');
  await clock.advance(500);
  assert.equal(r.ok, true);
  assert.equal(r.waitedMs, 2400);
  assert.ok(!guard.isGuarded('S1'));
  assert.equal(clock.pending(), 0, 'no timer or poll left behind');
}

// ---- other destinations are not held by one destination's take
{
  const { clock, dev, guard } = rig();
  dev.rest('S1'); dev.rest('S2');
  dev.take('S1');
  await clock.advance(100);
  assert.equal(guard.whenSettled(['S2']), null);
  assert.ok(guard.whenSettled(['S1', 'S2']), 'a master over both waits for S1');
}

// ---- a recall straight to program mid-take. Sent at once it lands in the buffer
// fading out, and the cut is gone when the take lands — what the Midra 4K and
// Alta 4K simulators did, and what the Cues and Presets views used to do.
{
  const { clock, dev } = rig();
  dev.rest('S1');
  dev.recall('S1', 1, 'PROGRAM'); dev.recall('S1', 2);
  dev.take('S1');
  await clock.advance(600);
  dev.recall('S1', 3, 'PROGRAM');
  await clock.advance(3000);
  assert.deepEqual(dev.onAir('S1'), { program: 2, preview: 3 }, 'the cut never reached air');
}
// …held, it goes the moment the take lands, and stays.
{
  const { clock, dev, guard } = rig();
  dev.rest('S1');
  dev.recall('S1', 1, 'PROGRAM'); dev.recall('S1', 2);
  dev.take('S1');
  await clock.advance(600);
  const p = guard.whenSettled(['S1']);
  assert.ok(p, 'held mid-take, to program as to preview');
  p.then((r) => { if (r.ok) dev.recall('S1', 3, 'PROGRAM'); });
  await clock.advance(2399);
  assert.deepEqual(dev.onAir('S1'), { program: 1, preview: 2 }, 'nothing sent mid-take');
  await clock.advance(1);
  assert.deepEqual(dev.onAir('S1'), { program: 3, preview: 1 }, 'on air as the take landed');
  await clock.advance(5000);
  assert.deepEqual(dev.onAir('S1'), { program: 3, preview: 1 });
}

// ---- a T-bar parked half way: give up after the take time + HOLD_GRACE_MS, and say so
{
  const { clock, dev, guard } = rig();
  dev.rest('S1');
  dev.take('S1', { parked: true });
  await clock.advance(1000);
  let r = null; guard.whenSettled(['S1']).then((x) => { r = x; });
  await clock.advance(3000 + HOLD_GRACE_MS - 1000 - 1);
  assert.equal(r, null);
  await clock.advance(1);
  assert.equal(r.ok, false);
  assert.match(r.message, /S1 still mid-take 6\.0 s after the take began/);
  // A later recall into the same parked take gives up at once rather than waiting it out again.
  let r2 = null; guard.whenSettled(['S1']).then((x) => { r2 = x; });
  await clock.advance(0);
  assert.equal(r2.ok, false);
  assert.match(r2.message, /6\.0 s after the take began/);
  assert.ok(guard.isGuarded('S1'), 'still guarded: a later recall waits too');
}

// ---- a take that never starts (refused, nothing to take) is let go after the grace
{
  const { clock, dev, guard } = rig();
  dev.rest('S1');
  dev.take('S1', { refuse: true });
  let r = null; guard.whenSettled(['S1']).then((x) => { r = x; });
  await clock.advance(START_GRACE_MS - 1);
  assert.equal(r, null);
  await clock.advance(1);
  assert.equal(r.ok, true);
  assert.ok(!guard.isGuarded('S1'));
}

// ---- a destination that never reports its transition is released after the grace
{
  const { clock, guard } = rig();
  guard.sent('DeviceObject/transition/$auxiliaryScreen/@items/2/control/@props/xTake', true);
  assert.ok(guard.isGuarded('A2'));
  await clock.advance(START_GRACE_MS);
  assert.ok(!guard.isGuarded('A2'));
}

// ---- a take from elsewhere (front panel, another client) is seen in flight and held
{
  const { clock, dev, guard } = rig();
  dev.st.set('S1', { transition: 'EFFECT_FROM_UP', moving: true });
  guard.saw('DeviceObject/transition/$screen/@items/1/status/@props/transition');
  assert.ok(guard.isGuarded('S1'));
  let r = null; guard.whenSettled(['S1']).then((x) => { r = x; });
  dev.st.set('S1', { transition: 'AT_DOWN', moving: false });
  guard.saw('DeviceObject/transition/$screen/@items/1/status/@props/transition');
  await clock.advance(0);
  assert.equal(r.ok, true);
}

// ---- …and one already in the cache when the recall is asked for
{
  const { dev, guard } = rig();
  dev.st.set('S1', { transition: 'EFFECT_FROM_DOWN', moving: true });
  assert.ok(guard.whenSettled(['S1']));
}

// ---- live updates off: the polls are how the landing is learnt, and they stop with it
{
  const { clock, dev, guard, polls } = rig({ pushes: false });
  dev.rest('S1');
  dev.take('S1');
  let r = null; guard.whenSettled(['S1']).then((x) => { r = x; });
  await clock.advance(3000 + POLL_MS);
  assert.equal(r.ok, true);
  assert.ok(polls.length >= 15, `polled ${polls.length} times`);
  const n = polls.length;
  await clock.advance(2000);
  assert.equal(polls.length, n, 'no polling once landed');
}

// ---- a landing seen only as the other end (never caught moving) still counts
{
  const { clock, dev, guard } = rig();
  dev.rest('S1', 'AT_DOWN');
  guard.sent('DeviceObject/transition/$screen/@items/1/control/@props/xTake', true);
  dev.st.set('S1', { transition: 'AT_UP', moving: false });
  guard.saw('DeviceObject/transition/$screen/@items/1/status/@props/transition');
  await clock.advance(0);
  assert.ok(!guard.isGuarded('S1'));
}

// ---- a stale take time is lengthened by what the polls bring, never shortened
{
  const { clock, dev, guard } = rig();
  dev.rest('S1');
  dev.setTakeMs('S1', 1000);
  dev.take('S1', { parked: true });
  let r = null; guard.whenSettled(['S1']).then((x) => { r = x; });
  dev.setTakeMs('S1', 5000);                 // the cache catches up with the recall that set it
  await clock.advance(1000 + HOLD_GRACE_MS);
  assert.equal(r, null, 'not given up on the stale 1 s');
  await clock.advance(4000);
  assert.equal(r.ok, false);
}

// ---- a fresh read: resolves once every destination has answered, or after FRESH_MS
{
  const { clock, dev, guard, polls } = rig();
  dev.rest('S1'); dev.rest('S2');
  let done = false;
  guard.fresh(['S1', 'S2']).then(() => { done = true; });
  assert.deepEqual(polls, ['S1', 'S2']);
  guard.saw('DeviceObject/transition/$screen/@items/1/status/@props/transition');
  await clock.advance(0);
  assert.equal(done, false, 'S2 has not answered');
  guard.saw('DeviceObject/transition/$screen/@items/2/status/@props/transition');
  await clock.advance(0);
  assert.equal(done, true);
  let late = false;
  guard.fresh(['S3']).then(() => { late = true; });
  await clock.advance(FRESH_MS);
  assert.equal(late, true, 'a destination that never answers does not hold the read up');
}

// ---- the cue queue
function cueRig(opts = {}) {
  const base = rig(opts);
  const { clock, dev, guard } = base;
  const warnings = [], cancelled = [], waited = [];
  const q = createCueQueue({
    hold: (ids, onHeld) => { const w = guard.whenSettled(ids); if (w) onHeld(); return w; },
    onWaiting: (job) => waited.push(job.n),
    onWarning: (job, msg) => warnings.push([job.n, msg]),
    onCancel: (job) => cancelled.push(job.n),
  });
  // A cue as the Cues view builds it: recall to preview, then the take a quarter
  // of a second later — or a Cut, straight to program with no take. Both hold
  // for their destinations.
  const cue = (n, { cut = false, targets = ['S1'] } = {}) => ({
    n, targets,
    run() {
      dev.recall('S1', n, cut ? 'PROGRAM' : 'PREVIEW');
      if (cut) return null;
      return new Promise((res) => clock.setTimeout(() => { dev.take('S1'); res(); }, 250));
    },
  });
  return { ...base, q, cue, warnings, cancelled, waited };
}

// No take running: a cue goes at once.
{
  const { dev, q, cue } = cueRig();
  dev.rest('S1');
  assert.equal(q.fire(cue(1)).waiting, false);
  assert.deepEqual(dev.log, ['recall S1 M1']);
}

// GO, GO: the second cue waits for the first one's take to land, then goes whole.
{
  const { clock, dev, q, cue, waited } = cueRig();
  dev.rest('S1');
  q.fire(cue(2));
  await clock.advance(100);
  assert.equal(q.fire(cue(3)).waiting, true, 'queued behind cue 2, which has not taken yet');
  await clock.advance(1000);
  assert.deepEqual(dev.log, ['recall S1 M2', 'take S1'], 'cue 3 has not recalled into the take');
  assert.deepEqual(waited, [3]);
  await clock.advance(2200);
  assert.deepEqual(dev.log, ['recall S1 M2', 'take S1', 'recall S1 M3']);
  await clock.advance(250);
  assert.deepEqual(dev.log, ['recall S1 M2', 'take S1', 'recall S1 M3', 'take S1']);
}

// Three GOs keep their order.
{
  const { clock, dev, q, cue } = cueRig({ takeMs: 1000 });
  dev.rest('S1');
  q.fire(cue(1)); q.fire(cue(2)); q.fire(cue(3));
  await clock.advance(10000);
  assert.deepEqual(dev.log.filter((l) => l.startsWith('recall')), ['recall S1 M1', 'recall S1 M2', 'recall S1 M3']);
  assert.equal(dev.log.length, 6);
}

// A hold that gives up does not fire the cue, and says why.
{
  const { clock, dev, q, cue, warnings } = cueRig();
  dev.rest('S1');
  dev.take('S1', { parked: true });
  q.fire(cue(4));
  await clock.advance(3000 + HOLD_GRACE_MS);
  assert.deepEqual(dev.log, ['take S1']);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0], 4);
  assert.match(warnings[0][1], /still mid-take/);
}

// Stop cancels a waiting cue, and the one queued behind it.
{
  const { clock, dev, q, cue, cancelled } = cueRig();
  dev.rest('S1');
  dev.take('S1');
  q.fire(cue(5)); q.fire(cue(6));
  await clock.advance(500);
  assert.equal(q.stop(), 2);
  assert.deepEqual(cancelled.sort(), [5, 6]);
  await clock.advance(10000);
  assert.deepEqual(dev.log, ['take S1'], 'neither touched the processor');
  // …and the queue is free again afterwards.
  q.fire(cue(7));
  assert.deepEqual(dev.log, ['take S1', 'recall S1 M7']);
}

// Stop between a cue's recall and its TAKE cannot recall it, so the next GO still waits behind that TAKE.
{
  const { clock, dev, q, cue } = cueRig();
  dev.rest('S1');
  q.fire(cue(8));
  await clock.advance(100);
  assert.equal(q.stop(), 0);
  q.fire(cue(9));
  await clock.advance(200);
  assert.deepEqual(dev.log, ['recall S1 M8', 'take S1'], 'cue 9 did not recall over the look being taken');
  await clock.advance(3100);
  assert.deepEqual(dev.log, ['recall S1 M8', 'take S1', 'recall S1 M9']);
}

// A Cut waits for a running take like any cue, goes to air as it lands, and
// keeps its place behind a GO — then waits for the take that GO started.
{
  const { clock, dev, q, cue, waited } = cueRig();
  dev.rest('S1');
  assert.equal(q.fire(cue(10, { cut: true })).waiting, false);
  assert.deepEqual(dev.log, ['recall S1 M10 to program'], 'nothing running: straight out');
  dev.recall('S1', 9);
  dev.take('S1');
  await clock.advance(600);
  assert.equal(q.fire(cue(11, { cut: true })).waiting, true, 'a cut is held by a take');
  await clock.advance(2399);
  assert.equal(dev.log.length, 3, 'nothing sent mid-take');
  await clock.advance(1);
  assert.deepEqual(dev.log.slice(3), ['recall S1 M11 to program']);
  assert.deepEqual(dev.onAir('S1'), { program: 11, preview: 10 });
  q.fire(cue(12));
  q.fire(cue(13, { cut: true }));
  await clock.advance(1000);
  assert.deepEqual(dev.log.slice(4), ['recall S1 M12', 'take S1'], 'the cut did not go into the take ahead of it');
  await clock.advance(2500);
  assert.deepEqual(dev.log.slice(4), ['recall S1 M12', 'take S1', 'recall S1 M13 to program']);
  assert.deepEqual(dev.onAir('S1'), { program: 13, preview: 11 });
  assert.deepEqual(waited, [11, 13]);
}

// A Cut into a T-bar left half way gives up, sends nothing and says so; Hold cancels a waiting one.
{
  const { clock, dev, q, cue, warnings } = cueRig();
  dev.rest('S1');
  dev.take('S1', { parked: true });
  q.fire(cue(14, { cut: true }));
  await clock.advance(3000 + HOLD_GRACE_MS);
  assert.deepEqual(dev.log, ['take S1']);
  assert.deepEqual(warnings.map(([n]) => n), [14]);
  assert.match(warnings[0][1], /still mid-take/);
}
{
  const { clock, dev, q, cue, cancelled } = cueRig();
  dev.rest('S1');
  dev.take('S1');
  q.fire(cue(15, { cut: true }));
  await clock.advance(500);
  assert.equal(q.stop(), 1);
  assert.deepEqual(cancelled, [15]);
  await clock.advance(10000);
  assert.deepEqual(dev.log, ['take S1'], 'nothing sent once the take landed');
}

// A hold that only checks first (live updates off: read, then decide) is not a wait.
{
  const clock = fakeClock();
  const log = [], waited = [];
  let midTake = false;
  const q = createCueQueue({
    hold: (ids, onHeld) => new Promise((res) => clock.setTimeout(() => {
      if (!midTake) return res({ ok: true });
      onHeld();
      clock.setTimeout(() => res({ ok: true }), 1000);
    }, 20)),
    onWaiting: (job) => waited.push(job.n),
  });
  const job = (n) => ({ n, targets: ['S1'], run: () => { log.push(n); return null; } });
  q.fire(job(1));
  assert.equal(q.busy(), true, 'checking');
  assert.deepEqual(q.waiting(), []);
  await clock.advance(20);
  assert.deepEqual(log, [1]);
  assert.deepEqual(waited, [], 'never said it was waiting for a take');
  midTake = true;
  q.fire(job(2));
  q.fire(job(3));
  await clock.advance(20);
  assert.deepEqual(waited, [2]);
  assert.equal(q.waiting().length, 1);
  assert.deepEqual(q.queued().map((j) => j.n), [3]);
  await clock.advance(1000);
  assert.deepEqual(log, [1, 2]);
  await clock.advance(1020);
  assert.deepEqual(log, [1, 2, 3]);
  assert.deepEqual(waited, [2, 3]);
  // Stop during the check cancels it too.
  const gone = [];
  const q2 = createCueQueue({ hold: () => new Promise((res) => clock.setTimeout(() => res({ ok: true }), 20)), onCancel: (j) => gone.push(j.n) });
  q2.fire(job(4));
  assert.equal(q2.stop(), 1);
  await clock.advance(100);
  assert.deepEqual(gone, [4]);
  assert.deepEqual(log, [1, 2, 3]);
}

console.log('awj-hold ok');
