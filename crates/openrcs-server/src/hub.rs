//! Shared state and the single connection to the device.
//!
//! One [`Hub`] owns the TCP link to the processor, a cache of the latest value
//! for every `(mnemonic, indices)` the device has reported, and a broadcast
//! channel that fans device frames out to every connected browser.

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use futures_util::StreamExt;
use openrcs_proto::{encode_get, encode_set, Decoder, Frame, Platform};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::{broadcast, mpsc, watch};
use tokio::time::{sleep, timeout, Duration};

/// A single value the device reported, keyed by mnemonic + index tuple.
pub type Key = (String, Vec<i64>);

/// Where the bridge points: one processor, and the dialect it speaks.
///
/// Optional, because an appliance boots before anyone has told it which
/// processor it is in front of. An unconfigured hub serves the UI and waits.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Target {
    pub addr: String,
    pub platform: Platform,
}

/// Fanned out to every browser client.
#[derive(Clone, Debug)]
pub enum DeviceEvent {
    /// A value update (mnemonic, indices, value).
    Value(String, Vec<i64>, i64),
    /// A device error/NAK code.
    Error(u16),
    /// Link up or down.
    Connected(bool),
    /// The hub now points somewhere else: the cache is empty and the variable
    /// table may have changed platform, so every client must be re-seeded.
    Retargeted,
    /// A processor answered on the discovery sweep (address, platform if the
    /// greeting identified it).
    Discovered(String, Option<&'static str>),
    /// The discovery sweep finished.
    DiscoverDone,
    /// A setup attempt was rejected before it reached the device.
    SetupError(String),
}

pub struct Hub {
    /// `None` until someone configures it. Guarded rather than fixed, because
    /// the appliance's whole setup flow is changing this at runtime.
    target: Mutex<Option<Target>>,
    state: Mutex<HashMap<Key, i64>>,
    to_device: mpsc::UnboundedSender<String>,
    events: broadcast::Sender<DeviceEvent>,
    connected: AtomicBool,
    /// Bumped on every retarget. The device loop watches it, so a change tears
    /// down the current link wherever it happens to be — mid-connect, mid-pump
    /// or mid-backoff. A `watch` rather than a `Notify` because it latches: a
    /// retarget raised while the loop is between `select!`s is still seen.
    generation: watch::Sender<u64>,
}

impl Hub {
    /// Build the hub and spawn the device-connection task.
    pub fn start(target: Option<Target>) -> Arc<Self> {
        let (to_device, from_clients) = mpsc::unbounded_channel::<String>();
        let (events, _) = broadcast::channel(4096);
        let (generation, _) = watch::channel(0u64);
        let hub = Arc::new(Hub {
            target: Mutex::new(target),
            state: Mutex::new(HashMap::new()),
            to_device,
            events,
            connected: AtomicBool::new(false),
            generation,
        });
        tokio::spawn(device_loop(hub.clone(), from_clients));
        hub
    }

    pub fn subscribe(&self) -> broadcast::Receiver<DeviceEvent> {
        self.events.subscribe()
    }

    pub fn is_connected(&self) -> bool {
        self.connected.load(Ordering::Relaxed)
    }

    pub fn target(&self) -> Option<Target> {
        self.target.lock().unwrap().clone()
    }

    pub fn is_configured(&self) -> bool {
        self.target.lock().unwrap().is_some()
    }

    /// The dialect to encode in. An unconfigured hub still has to hand the
    /// browser a variable table to render, so it answers with a default; no
    /// command can reach a device in that state anyway.
    pub fn platform(&self) -> Platform {
        self.target()
            .map(|t| t.platform)
            .unwrap_or(Platform::LiveCore)
    }

    /// `host:port` of the current target, or an empty string when unconfigured.
    pub fn device_addr(&self) -> String {
        self.target().map(|t| t.addr).unwrap_or_default()
    }

    /// Point the bridge at a different processor.
    ///
    /// The cache is dropped rather than merged: values from the old device
    /// would otherwise be indistinguishable from the new one's, and after a
    /// platform change the mnemonics themselves mean something else.
    pub fn retarget(&self, target: Option<Target>) {
        *self.target.lock().unwrap() = target;
        self.state.lock().unwrap().clear();
        self.connected.store(false, Ordering::Relaxed);
        self.generation.send_modify(|g| *g += 1);
        let _ = self.events.send(DeviceEvent::Retargeted);
        let _ = self.events.send(DeviceEvent::Connected(false));
    }

    /// Tell the browsers a setup attempt was rejected. Broadcast rather than
    /// answered directly, so a second panel showing the same appliance sees
    /// that the address it is watching did not take.
    pub fn report_setup_error(&self, reason: String) {
        let _ = self.events.send(DeviceEvent::SetupError(reason));
    }

    /// Current cache as a flat list, for a newly connected browser.
    pub fn snapshot(&self) -> Vec<(String, Vec<i64>, i64)> {
        let s = self.state.lock().unwrap();
        s.iter().map(|((m, i), v)| (m.clone(), i.clone(), *v)).collect()
    }

    /// Validate and send a set. Returns the encode error if the arguments are
    /// out of range, so the caller can report it to the browser.
    pub fn set(&self, mnem: &str, idx: &[u32], val: i64) -> Result<(), String> {
        let plat = self.platform();
        let def = plat
            .lookup(mnem)
            .ok_or_else(|| format!("unknown mnemonic {mnem}"))?;
        def.validate(idx, val).map_err(|e| e.to_string())?;
        let _ = self.to_device.send(encode_set(plat, mnem, idx, val));
        Ok(())
    }

    /// Request one variable.
    pub fn get(&self, mnem: &str, idx: &[u32]) -> Result<(), String> {
        let plat = self.platform();
        let def = plat
            .lookup(mnem)
            .ok_or_else(|| format!("unknown mnemonic {mnem}"))?;
        def.validate_indices(idx).map_err(|e| e.to_string())?;
        let _ = self.to_device.send(encode_get(plat, mnem, idx));
        Ok(())
    }

    /// Request every index combination of a variable, capped so a huge array
    /// can't flood the link. Returns how many gets were issued.
    pub fn scan(&self, mnem: &str, cap: usize) -> Result<usize, String> {
        let plat = self.platform();
        let def = plat
            .lookup(mnem)
            .ok_or_else(|| format!("unknown mnemonic {mnem}"))?;
        let total: usize = def.dims.iter().map(|&d| d as usize).product::<usize>().max(1);
        if total > cap {
            return Err(format!("{mnem} has {total} entries (cap {cap})"));
        }
        let mut idx = vec![0u32; def.dims.len()];
        let mut n = 0;
        loop {
            let _ = self.to_device.send(encode_get(plat, mnem, &idx));
            n += 1;
            if def.dims.is_empty() {
                break;
            }
            // odometer increment over the dimension bounds
            let mut axis = def.dims.len();
            loop {
                if axis == 0 {
                    return Ok(n);
                }
                axis -= 1;
                idx[axis] += 1;
                if idx[axis] < def.dims[axis] {
                    break;
                }
                idx[axis] = 0;
            }
        }
        Ok(n)
    }

    /// Send a raw line to the device (debug escape hatch).
    pub fn raw(&self, line: String) {
        let _ = self.to_device.send(line);
    }
}

/// Wire name for a platform, as the browser protocol spells it.
pub fn platform_name(p: Platform) -> &'static str {
    match p {
        Platform::LiveCore => "livecore",
        Platform::Midra => "midra",
    }
}

// ---------------------------------------------------------------- discovery
//
// An appliance has no keyboard, and typing an IP address on an on-screen keypad
// is the worst part of setting one up. Sweeping the local /24 turns that into
// picking from a list.
//
// This is READ ONLY, deliberately: it connects and listens, and never writes a
// byte. A sweep can run across a venue LAN while a show is on, so it must not
// be capable of poking a live processor even by accident.

const DISCOVER_CONNECT_TIMEOUT: Duration = Duration::from_millis(400);
/// How long to wait for a processor to introduce itself.
///
/// Measured, not guessed: a real NeXtage 16 sent its `ITcct` **1161 ms** after
/// the connection was accepted. An earlier 700 ms window found that box and
/// then failed to identify it, which is the worst of both — it looks like the
/// scan half-worked. This only applies to hosts that answered at all, and the
/// sweep is concurrent, so widening it costs the sweep almost nothing.
const DISCOVER_GREETING_WINDOW: Duration = Duration::from_millis(2000);
const DISCOVER_CONCURRENCY: usize = 64;

/// Probe every host on this machine's /24 for a processor, reporting each hit
/// as it answers so the UI can fill in progressively.
pub async fn discover(hub: Arc<Hub>) {
    let mut ports = vec![Platform::LiveCore.port(), Platform::Midra.port()];
    ports.sort_unstable();
    ports.dedup();

    // Some firmware refuses a second control session, so the box we are already
    // holding would look absent. Report it from what we already know instead of
    // probing it.
    if let Some(t) = hub.target() {
        if hub.is_connected() {
            let _ = hub.events.send(DeviceEvent::Discovered(
                t.addr.clone(),
                Some(platform_name(t.platform)),
            ));
        }
    }

    let Some(me) = local_v4() else {
        eprintln!("discover: no local IPv4 address to sweep from");
        let _ = hub.events.send(DeviceEvent::DiscoverDone);
        return;
    };
    let o = me.octets();

    let candidates: Vec<(Ipv4Addr, u16)> = (1u8..=254)
        .map(|h| Ipv4Addr::new(o[0], o[1], o[2], h))
        .filter(|ip| *ip != me)
        .flat_map(|ip| ports.iter().map(move |&p| (ip, p)))
        .collect();

    futures_util::stream::iter(candidates)
        .for_each_concurrent(DISCOVER_CONCURRENCY, |(ip, port)| {
            let hub = hub.clone();
            async move {
                if let Some(plat) = probe(ip, port).await {
                    let _ = hub
                        .events
                        .send(DeviceEvent::Discovered(format!("{ip}:{port}"), plat));
                }
            }
        })
        .await;

    let _ = hub.events.send(DeviceEvent::DiscoverDone);
}

/// `Some(platform)` if something answered — the inner option is `None` when it
/// answered but did not identify itself.
async fn probe(ip: Ipv4Addr, port: u16) -> Option<Option<&'static str>> {
    let addr = SocketAddr::new(IpAddr::V4(ip), port);
    let mut stream = timeout(DISCOVER_CONNECT_TIMEOUT, TcpStream::connect(addr))
        .await
        .ok()?
        .ok()?;

    // Listen for an unprompted greeting. Not every processor sends one — a
    // Pulse2 was measured silent for four seconds on a fresh connection — so
    // an unidentified answer is a normal result, not a failure. It is still
    // the useful half: finding the address is the hard part on a keypad, and
    // the platform is a two-button choice the operator already knows.
    //
    // Staying passive is the point. Sending a probe would identify everything,
    // and would also mean writing to a processor that might be live in a show.
    let mut buf = [0u8; 512];
    let n = match timeout(DISCOVER_GREETING_WINDOW, stream.read(&mut buf)).await {
        Ok(Ok(n)) => n,
        _ => 0,
    };
    Some(classify(&String::from_utf8_lossy(&buf[..n])))
}

/// Identify a platform from whatever it volunteered.
///
/// Test the LiveCore markers first: `PDEV` contains `DEV`, so the naive order
/// reads a LiveCore box as a Midra one.
///
/// `DEV` is included because a Midra answers `?` with it — but do not read that
/// as a greeting. Measured on a real Pulse2: **it sends nothing at all on
/// connect**, and the `DEV=259` that earlier notes describe as an unsolicited
/// push on connect is the reply to the UI's own `get('?')`. Midra therefore
/// scans as found-but-unidentified.
fn classify(greeting: &str) -> Option<&'static str> {
    if greeting.contains("PDEV") || greeting.contains("ITcct") {
        Some("livecore")
    } else if greeting.contains("DEV") {
        Some("midra")
    } else {
        None
    }
}

/// This machine's primary IPv4 address.
///
/// `connect` on a UDP socket sends nothing — it only asks the kernel which
/// source address it would route from. TEST-NET-1 is used as the destination so
/// nothing here implies traffic to a real host.
fn local_v4() -> Option<Ipv4Addr> {
    let sock = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect("192.0.2.1:9").ok()?;
    match sock.local_addr().ok()? {
        SocketAddr::V4(a) => Some(*a.ip()),
        SocketAddr::V6(_) => None,
    }
}

async fn device_loop(hub: Arc<Hub>, mut from_clients: mpsc::UnboundedReceiver<String>) {
    let mut gen = hub.generation.subscribe();
    gen.mark_unchanged();
    loop {
        let Some(target) = hub.target() else {
            // Unconfigured. Wait to be pointed at something — but keep draining
            // the client channel while waiting, or an unbounded queue of
            // commands nobody can deliver grows for as long as the UI is open.
            tokio::select! {
                _ = gen.changed() => {}
                _ = from_clients.recv() => {}
            }
            continue;
        };

        tokio::select! {
            // A retarget during a connect attempt must not wait out the
            // timeout: an appliance user correcting a typo'd address would
            // otherwise sit through the old address's connect.
            _ = gen.changed() => continue,
            res = TcpStream::connect(&target.addr) => match res {
                Ok(stream) => {
                    hub.connected.store(true, Ordering::Relaxed);
                    let _ = hub.events.send(DeviceEvent::Connected(true));
                    if let Err(e) = pump(&hub, stream, &mut from_clients, &mut gen).await {
                        eprintln!("device link lost: {e}");
                    }
                    hub.connected.store(false, Ordering::Relaxed);
                    let _ = hub.events.send(DeviceEvent::Connected(false));
                }
                Err(e) => eprintln!("connect {}: {e}", target.addr),
            },
        }

        tokio::select! {
            _ = sleep(Duration::from_secs(2)) => {}
            _ = gen.changed() => {}
        }
    }
}

async fn pump(
    hub: &Arc<Hub>,
    stream: TcpStream,
    from_clients: &mut mpsc::UnboundedReceiver<String>,
    gen: &mut watch::Receiver<u64>,
) -> std::io::Result<()> {
    let (mut rd, mut wr) = stream.into_split();
    let mut dec = Decoder::new();
    let mut buf = [0u8; 8192];
    loop {
        tokio::select! {
            // retargeted: drop this link so the loop can pick up the new one
            _ = gen.changed() => return Ok(()),
            // browser -> device
            line = from_clients.recv() => {
                match line {
                    Some(l) => wr.write_all(l.as_bytes()).await?,
                    None => return Ok(()),
                }
            }
            // device -> browser
            n = rd.read(&mut buf) => {
                let n = n?;
                if n == 0 {
                    return Ok(()); // peer closed
                }
                for frame in dec.feed(&buf[..n]) {
                    match frame {
                        Frame::Value(r) => {
                            hub.state.lock().unwrap()
                                .insert((r.mnemonic.clone(), r.indices.clone()), r.value);
                            let _ = hub.events.send(
                                DeviceEvent::Value(r.mnemonic, r.indices, r.value));
                        }
                        Frame::Error(code) => {
                            let _ = hub.events.send(DeviceEvent::Error(code));
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::classify;

    #[test]
    fn a_livecore_greeting_is_not_read_as_midra() {
        // PDEV contains DEV, so a naive substring order gets this backwards.
        assert_eq!(classify("PDEV97\r\n"), Some("livecore"));
        assert_eq!(classify("ITcct 0,1\n"), Some("livecore"));
    }

    #[test]
    fn a_midra_reply_is_recognised() {
        // Not a greeting: a real Pulse2 is silent on connect, and this is what
        // it answers `?` with. Kept because a device that has been spoken to
        // by something else may still have it in flight.
        assert_eq!(classify("DEV259\r\n"), Some("midra"));
    }

    #[test]
    fn silence_identifies_nothing() {
        // The normal Midra result, measured on real hardware: it answered the
        // connection and volunteered nothing. Reported as found but unlabelled
        // so the operator can pick the platform and try it.
        assert_eq!(classify(""), None);
        assert_eq!(classify("SSH-2.0-OpenSSH_9.2\r\n"), None);
    }
}
