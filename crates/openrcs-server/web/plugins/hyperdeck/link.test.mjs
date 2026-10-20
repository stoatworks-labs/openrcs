// node plugins/hyperdeck/link.test.mjs — the deck link, over a real socket.
//
// The deck on the other end is a stand-in written here, copying what a real
// Mitti 2.8.18 did to LivePremier Plus (d0093db, 2026-09-29): a command that
// ends in \r is answered `103 unsupported` (`device info` excepted), `device
// info` says `protocol version:1.11` with no space, and transport info says
// `loop : false` with a space before the colon. If the link goes back to
// CRLF, the first test fails.
//
// `host.link()` is the bridge's TCP link; here it is a node socket, which
// writes the page's text as the bridge does (src/plus.rs, run_link).
//
//   HYPERDECK_AT=127.0.0.1:9993 [HYPERDECK_PROFILE=mitti] node …/link.test.mjs
//
// also reads a real deck — device info, clips, slot and transport — and
// sends it no transport command.
import assert from 'node:assert/strict';
import net from 'node:net';
import { DeckLink } from './link.js';

const until = async (ok, ms = 3000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 10))) if (ok()) return true;
  return ok();
};

function socketHost() {
  const wire = [];
  return {
    wire,
    link(kind, host, port) {
      const data = new Set(), status = new Set();
      let sock = null;
      return {
        open() {
          sock = net.connect(port, host);
          sock.setEncoding('utf8');
          sock.on('connect', () => status.forEach(fn => fn('open', '')));
          sock.on('data', (d) => data.forEach(fn => fn(d)));
          sock.on('error', (e) => status.forEach(fn => fn('error', e.message)));
          sock.on('close', () => status.forEach(fn => fn('closed', 'connection dropped')));
        },
        close() { sock?.destroy(); },
        send(text) { wire.push(text); sock?.write(text); },
        onData(fn) { data.add(fn); return () => data.delete(fn); },
        onStatus(fn) { status.add(fn); return () => status.delete(fn); },
      };
    },
  };
}

/** A two-clip deck answering as Mitti's HyperDeck emulation does. */
function mittiLike(clips = [['A.mov', '00:00:05:00'], ['B.mov', '00:00:07:00']]) {
  const state = { status: 'stopped', clip: 1 };
  const block = (head, lines) => `${head}:\r\n${lines.join('\r\n')}\r\n\r\n`;
  const answer = (cmd) => {
    switch (cmd) {
      case 'device info': return block('204 device info', ['protocol version:1.11', 'model: Mitti', 'slot count: 1']);
      case 'transport info': return block('208 transport info', [`status: ${state.status}`, 'speed: 0', 'slot id: 1', `clip id: ${state.clip}`, 'single clip: false', 'display timecode: 00:00:00:00', 'timecode: 00:00:00:00', 'video format: 1080p25', 'loop : false']);
      case 'slot info': return block('202 slot info', ['slot id: 1', 'status: mounted']);
      case 'clips count': return block('214 clips count', [`clip count: ${clips.length}`]);
      case 'clips get': {
        let at = 0;
        return block('205 clips info', [`clip count: ${clips.length}`, ...clips.map(([name, len], i) => {
          const start = `00:00:${String(at).padStart(2, '0')}:00`;
          at += Number(len.split(':')[2]);
          return `${i + 1}: ${name} ${start} ${len}`;
        })]);
      }
      case 'play': state.status = 'play'; return '200 ok\r\n';
      case 'stop': state.status = 'stopped'; return '200 ok\r\n';
    }
    if (cmd.startsWith('notify:')) return '200 ok\r\n';
    return '103 unsupported\r\n';
  };
  const server = net.createServer((sock) => {
    sock.setEncoding('utf8');
    sock.write('500 connection info:\r\nprotocol version:1.11\r\nmodel: Mitti\r\n\r\n');
    let buffer = '';
    sock.on('data', (text) => {
      buffer += text;
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const raw = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        if (raw.endsWith('\r') && !/^device info/i.test(raw)) { sock.write('103 unsupported\r\n'); continue; }
        if (raw.trim()) sock.write(answer(raw.trim()));
      }
    });
    sock.on('error', () => {});
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    port: server.address().port,
    close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }),
  })));
}

// The stand-in refuses CR, as Mitti does — or the next test proves nothing.
{
  const deck = await mittiLike();
  const sock = net.connect(deck.port, '127.0.0.1');
  sock.setEncoding('utf8');
  let got = '';
  sock.on('data', (d) => { got += d; });
  assert.ok(await until(() => got.includes('500 connection info')));
  sock.write('transport info\r\n');
  assert.ok(await until(() => /103 unsupported/.test(got)), got);
  sock.write('device info\r\n');
  assert.ok(await until(() => /204 device info/.test(got)), got);
  sock.destroy();
  await deck.close();
}

// Mitti: commands go out LF-ended, and its spacing is read.
{
  const deck = await mittiLike();
  const host = socketHost();
  const link = new DeckLink(host, { id: 'm', name: 'Mitti', host: '127.0.0.1', port: deck.port, profile: 'mitti' });
  assert.ok(await until(() => link.clips.length === 2 && link.transport.status), `clip list and transport arrive (${link.status}, ${link.clips.length} clips)`);
  assert.equal(link.device.model, 'Mitti');
  assert.equal(link.device.protocol, '1.11');
  assert.equal(link.transport.loop, false);
  assert.deepEqual(link.clips.map(c => [c.name, c.start, c.duration]), [['A.mov', '00:00:00:00', '00:00:05:00'], ['B.mov', '00:00:05:00', '00:00:07:00']]);
  assert.deepEqual(await link.send('play'), { ok: true });
  assert.ok(await until(() => link.transport.status === 'play'), 'play is reported back');
  assert.ok(host.wire.length > 0 && host.wire.every(line => line.endsWith('\n') && !line.includes('\r')), JSON.stringify(host.wire));
  link.close();
  await deck.close();
}

// A real deck, read and nothing else, when asked for.
if (process.env.HYPERDECK_AT) {
  const [addr, port] = process.env.HYPERDECK_AT.split(':');
  const profile = process.env.HYPERDECK_PROFILE || 'hyperdeck';
  const host = socketHost();
  const replies = [];
  const link = new DeckLink(host, { id: 'real', name: addr, host: addr, port: Number(port) || 9993, profile });
  const fold = link.onReply.bind(link);
  link.onReply = (r) => { replies.push(r); fold(r); };
  // No 202 here: Mitti 2.8.19 never answers a bare `slot info` (the link
  // gives up on it after REPLY_TIMEOUT_MS), only `slot info: slot id: 1`.
  const wanted = [204, 205, 208];
  assert.ok(await until(() => wanted.every(c => replies.some(r => r.code === c)), 8000),
    `${process.env.HYPERDECK_AT} (${link.status}${link.error ? `: ${link.error}` : ''}) answered ${JSON.stringify(replies.map(r => `${r.code} ${r.text}`))}`);
  const refused = replies.filter(r => r.code >= 100 && r.code < 200);
  assert.deepEqual(refused, [], 'no command was refused');
  console.log(`real deck at ${process.env.HYPERDECK_AT}: ${link.device.model} ${link.device.software} (protocol ${link.device.protocol}), ${link.clips.length} clips, transport ${link.transport.status}, loop ${link.transport.loop}`);
  for (const r of replies) console.log(`  ${r.code} ${r.text}${r.lines.length ? ` (${r.lines.length} lines)` : ''}`);
  link.close();
}

console.log('hyperdeck link ok');
