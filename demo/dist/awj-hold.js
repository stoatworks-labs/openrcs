/*
 * AWJ: hold a recall while that destination's take is running.
 *
 * ## The failure this exists for
 *
 * On LivePremier, Midra 4K and Alta 4K the processor resolves `PREVIEW`
 * against the transition state — and on Midra 4K and Alta 4K `PROGRAM` too;
 * LivePremier's has not been looked at — so while a take is in flight the
 * buffer it calls preview is the one arriving on program, and the one it calls
 * program is the one leaving: the same DOWN/UP suffix rule the views use for
 * `buffers()`. No error, no warning either way; the wrong look is simply on
 * air.
 *
 * - A memory recalled to preview mid-take lands in the picture fading up and
 *   rides the take onto program. Midra 4K simulator 3.2.29 (Pulse 4K),
 *   2026-10-20: a 3 s take of memory 2, memory 3 recalled to preview 0.6 s
 *   in, memory 3 on program when it landed. The Cues view walked into it with
 *   any autofollow wait shorter than the take time.
 * - A memory recalled straight to program mid-take lands in the picture
 *   fading out, so the cut is gone when the take lands: memory 3 to program
 *   0.6 s into that take, and memory 2 on program, memory 3 on preview at the
 *   end. Midra 4K 3.2.29 and Alta 4K 1.3.7 simulators, and the vendor's own
 *   Web RCS does the same.
 *
 * ## What this does about it
 *
 * The guard watches takes — the ones this page sends (`sent`), and any the
 * processor reports in flight (`saw`) — and `whenSettled(ids)` is a promise
 * that those destinations' takes have landed, or null when none of them is
 * mid-take (then the caller sends at once, exactly as before). A recall made
 * mid-take, to either side, is not refused: it waits, and goes the moment the
 * take lands, when preview and program are the buffers they say. A cut made
 * mid-take is late by what was left of the take, which is the better of the
 * three ways out: refused, the operator presses again no sooner; and cutting
 * the take first does not stick on either simulator, since an `xCut`
 * mid-take lands at once and the running take's own end then flips the
 * buffers back, old program and all (`xTakeAbort` does nothing at all).
 *
 * It does not wait for ever. Past the take time plus `HOLD_GRACE_MS` (a T-bar
 * parked half way, a status that never arrived) the promise answers
 * `{ok: false}` and the caller must NOT send. Sending late into a buffer that
 * is still moving is the one outcome this exists to prevent, so "gave up"
 * means "did not send", never "sent anyway".
 *
 * The cue queue on top of it holds a whole cue, recall and take together, so
 * a cue's own TAKE can never go ahead of its recall, and keeps GO order.
 *
 * Ported from LivePremier Plus (plugins/preview-lock/core.js and
 * src/core/cuestack.js, 4c0bb43), less the vendor padlock, which openrcs does
 * not have. No DOM and no store here: app.js feeds it, and
 * awj-hold.test.mjs drives it with a fake clock.
 */

/** A take this page sent that has not started by now did not happen. */
export const START_GRACE_MS = 1500;

/** How long past its take time a held recall waits before it gives up. */
export const HOLD_GRACE_MS = 3000;

/** How often a guarded destination is read while live updates are off. */
export const POLL_MS = 200;

/** How long `fresh()` waits for a destination to answer a read. */
export const FRESH_MS = 400;

const TAKE_PROPS = 'xTake|xTakeUp|xTakeDown';   // a cut has no window to recall into
const MNG_TAKE = new RegExp(`^DeviceObject/transition/\\$(screen|auxiliaryScreen)/@items/(\\d+)/control/@props/(?:${TAKE_PROPS})$`);
const NLC_TAKE = new RegExp(`^DeviceObject/\\$screenAuxGroup/@items/([SA]\\d+)/control/@props/(?:${TAKE_PROPS})$`);
const MNG_STATUS = /^DeviceObject\/transition\/\$(screen|auxiliaryScreen)\/@items\/(\d+)\/status\/@props\/transition$/;
const NLC_STATUS = /^DeviceObject\/\$screenAuxGroup\/@items\/([SA]\d+)\/status\/@props\/(?:transition|take)$/;

const mngId = (list, n) => (list === 'auxiliaryScreen' ? 'A' : 'S') + n;

/** The destination a write starts a take on (`S1`, `A2`), or null. Both models. */
export function takeTarget(path, value) {
  if (value !== true || typeof path !== 'string') return null;
  let m = MNG_TAKE.exec(path);
  if (m) return mngId(m[1], m[2]);
  m = NLC_TAKE.exec(path);
  return m ? m[1] : null;
}

/** The destination a value says something about the take state of, or null. */
export function statusTarget(path) {
  if (typeof path !== 'string') return null;
  let m = MNG_STATUS.exec(path);
  if (m) return mngId(m[1], m[2]);
  m = NLC_STATUS.exec(path);
  return m ? m[1] : null;
}

const resting = (t) => t === 'AT_UP' || t === 'AT_DOWN';

/**
 * The guard.
 *
 * @param {object} o
 * @param {(id: string) => {transition?: string, moving?: boolean}} o.state
 *   what this page knows of a destination's take: the transition state as last
 *   read (undefined when it never answered) and whether a fade is in progress
 * @param {(id: string) => number} o.takeMs   its take time, in ms
 * @param {(id: string) => void} [o.poll]     ask the processor again (a no-op while it pushes)
 * @param {() => void} [o.onChange]           something was guarded or let go
 * @param {object} [o.clock]                  `{now, setTimeout, clearTimeout, setInterval, clearInterval}`
 */
export function createTakeGuard({ state, takeMs, poll = () => {}, onChange = () => {}, clock = globalThis }) {
  const now = () => (clock.now ? clock.now() : Date.now());
  /** id -> { from, since, moving, cause, timer, poller } */
  const guarded = new Map();
  /** Callers waiting for a destination to answer a read: { ids, resolve, timer } */
  const readers = new Set();
  /** Callers waiting for takes to land: { ids, started, deadline, resolve, timer } */
  const waiters = new Set();

  const ms = (id) => { const v = takeMs(id); return Number.isFinite(v) && v > 0 ? v : 0; };

  function finish(w, result) {
    if (!waiters.delete(w)) return;
    if (w.timer) clock.clearTimeout(w.timer);
    w.resolve({ ...result, ids: [...w.ids], waitedMs: now() - w.started });
  }

  function settleWaiters() {
    for (const w of [...waiters]) if ([...w.ids].every((id) => !guarded.has(id))) finish(w, { ok: true });
  }

  function arm(id, cause) {
    if (guarded.has(id)) return;
    const s = state(id) || {};
    const g = { from: s.transition, since: now(), moving: !!s.moving, cause, timer: null, poller: null };
    guarded.set(id, g);
    /* A take this page sent may never start (refused, nothing to take); look
       again once the grace is up so it is let go rather than held. */
    if (cause === 'take') g.timer = clock.setTimeout(() => { g.timer = null; look(id); }, START_GRACE_MS);
    g.poller = clock.setInterval(() => poll(id), POLL_MS);
    poll(id);
    onChange();
  }

  function release(id) {
    const g = guarded.get(id);
    if (!g) return;
    if (g.timer) clock.clearTimeout(g.timer);
    if (g.poller) clock.clearInterval(g.poller);
    guarded.delete(id);
    onChange();
    settleWaiters();
  }

  /** Read the destination's take state and act on it. */
  function look(id) {
    const s = state(id) || {};
    const g = guarded.get(id);
    const late = g && g.cause === 'take' && now() - g.since >= START_GRACE_MS;
    if (s.transition === undefined && !s.moving) {
      /* Never said where its T-bar is: nothing will say it landed either,
         so the grace is all there is. */
      if (late) release(id);
      return;
    }
    if (s.moving || !resting(s.transition)) {
      if (g) g.moving = true;
      else arm(id, 'moving');
      return;
    }
    if (!g) return;
    /* At rest: it landed if it was seen moving, or rests at the other end. */
    if (g.moving || s.transition !== g.from) return release(id);
    /* At rest where it started and never seen moving: a take this page sent
       that has not shown up yet — until the grace runs out. */
    if (late) release(id);
  }

  return {
    /** Every write this page sends to the processor. */
    sent(path, value) {
      const id = takeTarget(path, value);
      if (id) arm(id, 'take');
    },
    /** Every value the processor reports, pushed or read. */
    saw(path) {
      const id = statusTarget(path);
      if (!id) return;
      look(id);
      for (const r of [...readers]) {
        r.ids.delete(id);
        if (!r.ids.size) { readers.delete(r); clock.clearTimeout(r.timer); r.resolve(); }
      }
    },
    /**
     * Read these destinations' take state afresh (through `poll`) and resolve
     * once each has answered, or after FRESH_MS. For when nothing is pushing
     * it: a take started at the front panel is otherwise unseen.
     */
    fresh(ids) {
      const r = { ids: new Set((ids || []).filter(Boolean)), resolve: null, timer: null };
      if (!r.ids.size) return Promise.resolve();
      return new Promise((resolve) => {
        r.resolve = resolve;
        r.timer = clock.setTimeout(() => { readers.delete(r); resolve(); }, FRESH_MS);
        readers.add(r);
        for (const id of r.ids) poll(id);
      });
    },
    look,
    isGuarded: (id) => guarded.has(id),
    /** What is guarded now: `[{id, cause, since}]`. */
    guarded: () => [...guarded].map(([id, g]) => ({ id, cause: g.cause, since: g.since })),
    /**
     * A promise that these destinations' takes have landed, or null when none
     * of them is mid-take. Resolves `{ok: true}` when the last one lands, or
     * `{ok: false, message}` once the longest take time plus HOLD_GRACE_MS has
     * passed with one still in flight; the caller must then not send.
     */
    whenSettled(ids) {
      const asked = [...new Set((ids || []).filter(Boolean))];
      for (const id of asked) look(id);   // a take from elsewhere already in the cache
      const want = asked.filter((id) => guarded.has(id));
      if (!want.length) return null;
      const started = now();
      return new Promise((resolve) => {
        const w = { ids: new Set(want), started, deadline: 0, resolve, timer: null };
        /* The deadline is read now, before the recall this guards could
           overwrite the take time (a Midra 4K recall does), and only ever
           lengthened later: with live updates off the take time in the cache
           can be one recall stale, and the polls bring the real one. */
        const deadlineOf = () => Math.max(...[...w.ids].filter((id) => guarded.has(id))
          .map((id) => guarded.get(id).since + ms(id) + HOLD_GRACE_MS));
        const check = () => {
          w.timer = null;
          const still = [...w.ids].filter((id) => guarded.has(id));
          if (!still.length) return finish(w, { ok: true });
          w.deadline = Math.max(w.deadline, deadlineOf());
          if (w.deadline > now()) { w.timer = clock.setTimeout(check, w.deadline - now()); return; }
          const began = Math.min(...still.map((id) => guarded.get(id).since));
          finish(w, { ok: false, message: `${still.join(', ')} still mid-take ${((now() - began) / 1000).toFixed(1)} s after the take began` });
        };
        w.deadline = deadlineOf();
        w.timer = clock.setTimeout(check, Math.max(w.deadline - started, 0));
        waiters.add(w);
      });
    },
    /** Let everything go: the link went elsewhere, or the page is closing. */
    releaseAll() { for (const id of [...guarded.keys()]) release(id); },
  };
}

/**
 * The cue queue: fire cues in GO order, and never into a take.
 *
 * - **A cue that recalls into a destination mid-take waits** for that take
 *   to land, then runs whole — recall and take together. Holding only the
 *   recall would let the cue's own TAKE go first and take the previous
 *   preview to air. A Cut straight to program waits the same way.
 * - **Cues run in the order GO was pressed.** One fired while an earlier cue
 *   is waiting, or is between its recall and its TAKE, queues behind it and
 *   asks the guard only once that cue's TAKE has gone, which is what puts its
 *   destination mid-take. Asked any earlier it would see a destination at
 *   rest, recall at once, and overwrite the look about to be taken.
 * - **A hold that gives up means the cue does not run**, and `onWarning` says
 *   so. There is no "fire anyway".
 * - **`stop()` cancels whatever is still waiting.** It has not touched the
 *   processor yet.
 * - A cue with no targets is never held, though it still keeps its place in
 *   the order.
 *
 * @param {object} o
 * @param {(ids: string[], onHeld: () => void) => (Promise<{ok: boolean, message?: string}>|null)} o.hold
 *   null to run now, or a promise to run on (`ok`) or to drop (`!ok`). It calls
 *   `onHeld` when a take is what it is waiting for, which a check that only
 *   reads the take state first does not.
 * @param {(job: object, ids: string[]) => void} [o.onWaiting]
 * @param {(job: object, message: string) => void} [o.onWarning]  it gave up
 * @param {(job: object) => void} [o.onCancel]                    stop() took it
 * @param {() => void} [o.onChange]
 */
export function createCueQueue({ hold, onWaiting = () => {}, onWarning = () => {}, onCancel = () => {}, onChange = () => {} }) {
  let pending = null;      // the last job still to finish, so the next one queues behind it
  let running = null;      // a job between its recall and its TAKE, which stop() cannot recall
  let epoch = 0;           // bumped by stop(): whatever was queued before it is cancelled
  const asking = new Set();    // jobs whose hold has not answered yet
  const waiting = new Map();   // the ones of those held by a take -> the ids they wait on
  const queued = new Set();    // jobs behind another, not yet asking

  function track(promise) {
    const tracked = promise.then(() => {}, () => {});
    pending = tracked;
    tracked.then(() => { if (pending === tracked) pending = null; });
    return tracked;
  }
  /* The job's writes, now. A TAKE still to come keeps the next cue behind
     it even through stop(): the recall has gone, and a cue let past it
     would recall over the look about to be taken. */
  function start(job) {
    const done = job.run();
    if (!done) return null;
    const r = Promise.resolve(done).then(() => {}, () => {});
    running = r;
    r.then(() => { if (running === r) running = null; });
    return r;
  }

  /* The hold's onHeld for `job`: it is a take it waits for, so say so. A
     hold asked before the job was queued (fire's first look) may have said
     so already, in `early`. */
  function heldBy(job, mine) {
    return () => {
      if (mine !== epoch || !asking.has(job) || waiting.has(job)) return;
      waiting.set(job, job.targets);
      onWaiting(job, job.targets);
      onChange();
    };
  }

  function queue(job, ahead, wait, early) {
    const mine = epoch;
    if (ahead) queued.add(job);
    const run = (async () => {
      if (ahead) await ahead;
      queued.delete(job);
      if (mine !== epoch) return;
      const held = heldBy(job, mine);
      asking.add(job);
      if (early) { if (early.held) held(); else early.fn = held; }
      const h = wait || (job.targets.length ? hold(job.targets, held) : null);
      if (h) {
        let r;
        try { r = await h; } catch (err) { r = { ok: false, message: err && err.message ? err.message : String(err) }; }
        if (mine !== epoch) return;
        asking.delete(job);
        if (waiting.delete(job)) onChange();
        if (!r || !r.ok) { onWarning(job, (r && r.message) || 'the take did not land'); return; }
      }
      asking.delete(job);
      const done = start(job);
      if (done) await done;
    })();
    track(run);
    return { waiting: true };
  }

  return {
    /**
     * `job` is `{targets, run, ...}`: the destinations it recalls into,
     * preview or program, and `run()` — the writes, now — which returns a
     * promise that its TAKE has gone, or nothing when it has no take still
     * to send.
     */
    fire(job) {
      if (pending) return queue(job, pending, null);
      const early = { held: false, fn: null };
      const wait = job.targets.length ? hold(job.targets, () => (early.fn ? early.fn() : (early.held = true))) : null;
      if (wait) return queue(job, null, wait, early);
      const done = start(job);
      if (done) track(done);
      return { waiting: false };
    },
    /** Cancel every cue still waiting or queued. Cues already sent are not undone. */
    stop() {
      const had = [...queued, ...asking];
      epoch++;
      asking.clear(); waiting.clear(); queued.clear();
      pending = running ? track(running) : null;
      for (const job of had) onCancel(job);
      if (had.length) onChange();
      return had.length;
    },
    /** Jobs waiting for a take, and jobs queued behind them. */
    waiting: () => [...waiting].map(([job, ids]) => ({ job, ids })),
    queued: () => [...queued],
    busy: () => asking.size > 0 || queued.size > 0,
  };
}
