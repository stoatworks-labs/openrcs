/*
 * One deck's connection: the HyperDeck protocol, through a TCP link the
 * bridge holds for this page.
 *
 * LivePremier Plus's DeckLink (plugins/hyperdeck/link.js there), moved off a
 * Node socket onto `host.link()`. The rules it keeps are the same:
 *
 * - Nothing here writes the deck's state. Transport, clip and timecode are
 *   only ever what the deck reported.
 * - One command in flight: the protocol answers in order, so a slow deck
 *   times out on the command it did not answer, not on the next one.
 * - The protocol has no end-of-clip message. A deck that stops by itself with
 *   (almost) nothing left, or plays on into the next clip, has ended its clip
 *   — unless we sent the stop or goto in the last moment.
 */

import { ReplyParser, isAsync, isError, readTransport, readClips, readDevice, readSlot, clipPosition, COMMANDS, RECORD_COMMANDS, profileOf } from './protocol.js';

const REPLY_TIMEOUT_MS = 3000;
const PLAY_POLL_MS = 250;
const IDLE_POLL_MS = 2000;
const CLIPS_EVERY_MS = 15000;
const OURS_MS = 1500;
const END_SLACK_S = 1.0;

export class DeckLink {
  constructor(host, deck, { onChange = () => {}, onEnded = () => {} } = {}) {
    this.deck = deck;
    this.profile = profileOf(deck.profile);
    this.onChange = onChange;
    this.onEnded = onEnded;
    this.status = 'disconnected';
    this.error = null;
    this.reset();
    this.link = host.link('hyperdeck', deck.host, deck.port);
    this.offData = this.link.onData((text) => {
      for (const reply of this.parser.push(text)) { try { this.onReply(reply); } catch (err) { console.warn('hyperdeck', err); } }
    });
    this.offStatus = this.link.onStatus((state, detail) => {
      if (state === 'open') { this.reset(); this.error = null; this.set('connected'); this.hello(); }
      else if (state === 'error' || state === 'closed') { this.error = detail || null; this.failAll(detail || state); clearTimeout(this.pollTimer); this.set(state === 'error' ? 'error' : 'disconnected'); }
    });
    this.set('connecting');
    this.link.open();
  }

  reset() {
    this.device = null; this.transport = {}; this.clips = []; this.slot = {};
    this.remoteDisabled = false; this.run = 0; this.lastOurs = 0; this.clipsAt = 0;
    this.queue = []; this.inFlight = null; this.parser = new ReplyParser();
  }
  close() { clearTimeout(this.pollTimer); this.failAll('closed'); this.offData(); this.offStatus(); this.link.close(); this.set('disconnected'); }
  set(status) { if (this.status !== status) { this.status = status; this.onChange(); } }
  position() { return clipPosition(this.transport, this.clips); }

  hello() {
    if (this.profile.notify) void this.request('notify: transport: true slot: true');
    void this.request('device info');
    void this.refreshClips();
    void this.request('slot info');
    void this.request('transport info');
    this.schedulePoll();
  }
  schedulePoll() {
    clearTimeout(this.pollTimer);
    const playing = this.transport.status === 'play' || this.transport.status === 'record';
    this.pollTimer = setTimeout(() => {
      if (this.status !== 'connected') return;
      const polls = this.queue.filter(q => q.poll).length + (this.inFlight?.poll ? 1 : 0);
      if (!polls) {
        void this.request('transport info', { poll: true });
        if (Date.now() - this.clipsAt > CLIPS_EVERY_MS) void this.refreshClips();
      }
      this.schedulePoll();
    }, playing ? PLAY_POLL_MS : IDLE_POLL_MS);
  }
  refreshClips() { this.clipsAt = Date.now(); return this.request('clips get', { poll: true }); }

  request(line, { poll = false } = {}) {
    return new Promise((resolve) => {
      if (this.status !== 'connected') { resolve({ code: 0, text: 'not connected', fields: {}, lines: [] }); return; }
      this.queue.push({ line, resolve, poll });
      this.pump();
    });
  }
  pump() {
    if (this.inFlight || !this.queue.length) return;
    const next = this.queue.shift();
    next.timer = setTimeout(() => {
      if (this.inFlight !== next) return;
      this.inFlight = null;
      next.resolve({ code: 0, text: 'no answer', fields: {}, lines: [] });
      this.pump();
    }, REPLY_TIMEOUT_MS);
    this.inFlight = next;
    this.link.send(`${next.line}\r\n`);
  }
  failAll(why) {
    const pending = [...(this.inFlight ? [this.inFlight] : []), ...this.queue];
    this.inFlight = null; this.queue = [];
    for (const p of pending) { clearTimeout(p.timer); p.resolve({ code: 0, text: why, fields: {}, lines: [] }); }
  }
  onReply(reply) {
    if (isAsync(reply)) { this.fold(reply); return; }
    const done = this.inFlight;
    if (done) { clearTimeout(done.timer); this.inFlight = null; }
    this.fold(reply);
    done?.resolve(reply);
    this.pump();
  }
  fold(reply) {
    switch (reply.code) {
      case 500: case 204: this.device = { ...(this.device || {}), ...readDevice(reply.fields) }; break;
      case 205: this.clips = readClips(reply.lines); break;
      case 202: case 502: {
        const slot = readSlot(reply.fields);
        if (slot.status && slot.status !== this.slot.status) this.clipsAt = 0;
        this.slot = { ...this.slot, ...slot };
        break;
      }
      case 208: case 508: this.foldTransport(readTransport(reply.fields)); return;
      case 111: this.remoteDisabled = true; break;
      default: return;
    }
    this.onChange();
  }
  foldTransport(next) {
    const before = this.transport, was = before.status;
    const after = { ...before, ...next };
    const wasPlaying = was === 'play', nowPlaying = after.status === 'play';
    const ours = Date.now() - this.lastOurs < OURS_MS;
    if (wasPlaying && !nowPlaying && !ours) {
      const { remaining } = clipPosition(before, this.clips);
      if (remaining == null || remaining <= END_SLACK_S) this.onEnded({ clip: before.clip, run: this.run });
    }
    const clipChanged = before.clip != null && after.clip != null && after.clip !== before.clip;
    if (wasPlaying && nowPlaying && clipChanged && !ours) this.onEnded({ clip: before.clip, run: this.run, next: after.clip });
    if ((!wasPlaying && nowPlaying) || (nowPlaying && clipChanged)) this.run += 1;
    if (was === 'record' && after.status !== 'record') this.clipsAt = 0;
    const moved = JSON.stringify(before) !== JSON.stringify(after);
    this.transport = after;
    if (was !== after.status) this.schedulePoll();
    if (moved) this.onChange();
  }

  /** A named command, answered {ok, error?} once the deck has replied. */
  async send(name, args = {}) {
    const build = COMMANDS[name];
    if (!build) return { ok: false, error: `no command "${name}"` };
    if (RECORD_COMMANDS.has(name) && !this.profile.record) return { ok: false, error: `${this.deck.name} does not record (${this.profile.label})` };
    const line = build(args);
    if (!line) return { ok: false, error: `${name}: bad argument` };
    if (this.status !== 'connected') return { ok: false, error: `${this.deck.name} is not connected` };
    if (name !== 'play' && name !== 'record') this.lastOurs = Date.now();
    let reply = await this.request(line);
    if (reply.code === 111) {
      // The one setting this will change on a deck, and only because the
      // command just sent says the operator wants it controlled.
      await this.request('remote: enable: true');
      reply = await this.request(line);
      if (reply.code !== 111) { this.remoteDisabled = false; this.onChange(); }
    }
    void this.request('transport info', { poll: true });
    if (isError(reply) || reply.code === 0) return { ok: false, error: `${this.deck.name}: ${reply.text}` };
    return { ok: true };
  }
}
