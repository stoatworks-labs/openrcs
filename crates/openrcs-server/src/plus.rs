//! The plugin half of the bridge: shared data, leases, TCP links and OSC.
//!
//! The web surface's plugins (`web/plugins/`) run in the browser, and a
//! browser has three gaps a plugin keeps falling into. This module fills them
//! and does nothing else — it has no idea what a layer group or a HyperDeck is.
//!
//! * **Shared data.** A plugin's state (layer groups, lock lists, a router
//!   patch) belongs to the show, not to one browser, so it lives here, is
//!   written to `plugin-data.json` beside the config, and is handed to every
//!   open page. A write from one page reaches the others at once.
//! * **Leases.** Some things must happen once however many pages are open — a
//!   HyperDeck rule that takes a screen, timecode firing a cue. A page asks for
//!   a named lease; the bridge grants it to one page and hands it to the next
//!   in line when that page goes away.
//! * **Links.** A browser has no raw TCP. A page asks the bridge to hold a
//!   connection to `host:port` and relays through it; bytes come back as
//!   `ext` events. The page names each link with its own id, so every page
//!   has its own connection: these protocols pair each reply with the command
//!   before it, and two pages' commands on one socket would cross.
//!
//! * **USB panels.** A page cannot complete a DaVinci Resolve Speed Editor's
//!   handshake over WebHID (`speed_editor.rs` says why), so the bridge holds
//!   the panel. Its input reports go to the one page holding the
//!   `speed-editor.driver` lease, that page's lamps come back, and the panel is
//!   open only while somebody holds it. The mapping stays in the page.
//!
//! And OSC: a UDP listener, off until a page turns it on, that writes
//! variables itself and forwards everything that needs the surface's own
//! logic (a take, a cue GO) to the page holding the `osc-input.actions` lease.
//! A take is not re-implemented here on purpose: the one in `app.js` carries
//! the hardware-proven details (the Midra's T-bar that must be seen to travel,
//! the LiveCore's GCupd) and a second copy would drift from it.

use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, Weak};

use serde_json::{json, Map, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpStream, UdpSocket};
use tokio::sync::{broadcast, mpsc};
use tokio::task::JoinHandle;
use tokio::time::{sleep, timeout, Duration};

use crate::hid;
use crate::hub::Hub;
use crate::speed_editor;

pub type ClientId = u64;

/// The lease a page takes to receive OSC-forwarded actions.
pub const OSC_ACTIONS_LEASE: &str = "osc-input.actions";
/// The shared key the OSC plugin writes its settings to.
pub const OSC_CONFIG_KEY: &str = "osc-input.config";
/// The lease a page holds to drive the Speed Editor: one page acts on the
/// panel at a time, and the panel is open only while somebody holds it.
pub const SPEED_EDITOR_LEASE: &str = "speed-editor.driver";
/// What a page's notes about the panel are called (`{what: …}`).
const SPEED_EDITOR_NOTE: &str = "speed-editor";
/// The most output reports one message may carry, and the longest of them.
const PANEL_WRITE_MAX: usize = 16;
const PANEL_REPORT_MAX: usize = 64;

/// Anything larger is not plugin state; refuse it rather than grow the file.
const KV_VALUE_MAX: usize = 1 << 20;
/// How many links one bridge will hold. Each is a TCP connection and a task.
const LINKS_MAX: usize = 64;

#[derive(Clone, Debug)]
pub enum PlusEvent {
    Kv { k: String, v: Value },
    Lease { name: String, holder: Option<ClientId> },
    /// `ev` is `open`, `data`, `closed` or `error`.
    Ext { key: String, ev: &'static str, data: String },
    /// A forwarded action, for one client only.
    Action { to: ClientId, name: String, args: Vec<Value> },
    /// Anything else a plugin's page wants to hear: `{what: …}`.
    Note(Value),
    /// A note for one client only: a panel's input reports, to its driver.
    To { to: ClientId, body: Value },
}

struct Link {
    out: mpsc::UnboundedSender<Vec<u8>>,
    clients: HashSet<ClientId>,
    task: JoinHandle<()>,
}

/// One relayed thumbnail and when it was fetched.
struct Snap {
    at: std::time::Instant,
    jpeg: Vec<u8>,
}

#[derive(Default)]
struct OscState {
    task: Option<JoinHandle<()>>,
    port: u16,
    status: Value,
}

pub struct Plus {
    hub: Arc<Hub>,
    kv: Mutex<Map<String, Value>>,
    kv_path: PathBuf,
    tx: broadcast::Sender<PlusEvent>,
    leases: Mutex<HashMap<String, Vec<ClientId>>>,
    links: Mutex<HashMap<String, Link>>,
    next: AtomicU64,
    osc: Mutex<OscState>,
    /// Input thumbnails relayed from a LiveCore, by input number. An async
    /// mutex, held across the fetch, so ten pages asking at once cause one
    /// request to the processor rather than ten.
    snaps: tokio::sync::Mutex<HashMap<u32, Snap>>,
    /// The Speed Editor, if one is plugged in here (speed_editor.rs).
    speed_editor: speed_editor::Link,
}

/// How long a relayed thumbnail is served before it is fetched again. The
/// surface asks every 3 s; this is short of that so each tick is fresh.
const SNAP_TTL: Duration = Duration::from_millis(2000);
/// JPEG quality for a relayed thumbnail. A thumbnail is a few hundred pixels
/// across; this is where the file stops getting visibly worse.
const SNAP_QUALITY: u8 = 70;

impl Plus {
    pub fn start(hub: Arc<Hub>, kv_path: PathBuf) -> Arc<Self> {
        Self::start_with(hub, kv_path, hid::system(), speed_editor::Timing::default())
    }

    /// As `start`, with the Speed Editor reached through `hid` — a fake panel
    /// in the tests.
    pub fn start_with(hub: Arc<Hub>, kv_path: PathBuf, hid: Result<hid::Opener, String>, timing: speed_editor::Timing) -> Arc<Self> {
        let kv = match std::fs::read_to_string(&kv_path) {
            Ok(s) => serde_json::from_str::<Map<String, Value>>(&s).unwrap_or_else(|e| {
                eprintln!("ignoring unreadable {}: {e}", kv_path.display());
                Map::new()
            }),
            Err(_) => Map::new(),
        };
        let plus = Arc::new_cyclic(|me: &Weak<Self>| {
            let me = me.clone();
            let on_event: speed_editor::OnEvent = Arc::new(move |ev| {
                if let Some(plus) = me.upgrade() {
                    plus.panel_event(ev);
                }
            });
            Self {
                hub,
                kv: Mutex::new(kv),
                kv_path,
                tx: broadcast::channel(1024).0,
                leases: Mutex::new(HashMap::new()),
                links: Mutex::new(HashMap::new()),
                next: AtomicU64::new(1),
                osc: Mutex::new(OscState::default()),
                snaps: tokio::sync::Mutex::new(HashMap::new()),
                speed_editor: speed_editor::Link::new(hid, timing, on_event),
            }
        });
        plus.apply_osc_config();
        plus
    }

    pub fn subscribe(&self) -> broadcast::Receiver<PlusEvent> {
        self.tx.subscribe()
    }

    pub fn new_client(&self) -> ClientId {
        self.next.fetch_add(1, Ordering::SeqCst)
    }

    // ---- shared data ----

    pub fn kv_snapshot(&self) -> Vec<(String, Value)> {
        self.kv.lock().unwrap().iter().map(|(k, v)| (k.clone(), v.clone())).collect()
    }

    pub fn kv_get(&self, k: &str) -> Option<Value> {
        self.kv.lock().unwrap().get(k).cloned()
    }

    pub fn kv_set(self: &Arc<Self>, k: String, v: Value) {
        // Keys are `<plugin>.<name>`; anything else did not come from the host.
        if k.len() > 128 || !k.contains('.') {
            eprintln!("kv: refusing key {k:?}");
            return;
        }
        if serde_json::to_string(&v).map(|s| s.len()).unwrap_or(usize::MAX) > KV_VALUE_MAX {
            eprintln!("kv: refusing {k}, larger than {KV_VALUE_MAX} bytes");
            return;
        }
        let json = {
            let mut kv = self.kv.lock().unwrap();
            kv.insert(k.clone(), v.clone());
            serde_json::to_string_pretty(&*kv).ok()
        };
        if let Some(json) = json {
            if let Some(dir) = self.kv_path.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            // Written whole each time: the file is small, and a torn write is
            // avoided by writing beside it and renaming over.
            let tmp = self.kv_path.with_extension("json.tmp");
            if std::fs::write(&tmp, json).and_then(|_| std::fs::rename(&tmp, &self.kv_path)).is_err() {
                eprintln!("could not save {}", self.kv_path.display());
            }
        }
        let is_osc = k == OSC_CONFIG_KEY;
        let _ = self.tx.send(PlusEvent::Kv { k, v });
        if is_osc {
            self.apply_osc_config();
        }
    }

    // ---- leases ----

    pub fn lease(&self, name: String, client: ClientId, want: bool) {
        if name.len() > 128 {
            return;
        }
        let panel = name == SPEED_EDITOR_LEASE;
        let changed = {
            let mut leases = self.leases.lock().unwrap();
            let queue = leases.entry(name.clone()).or_default();
            let before = queue.first().copied();
            // Asking again keeps a page's place — a reconnect re-asks for
            // everything, and must not hand its own lease to the next page.
            if !want {
                queue.retain(|&c| c != client);
            } else if !queue.contains(&client) {
                queue.push(client);
            }
            let after = queue.first().copied();
            if queue.is_empty() {
                leases.remove(&name);
            }
            // A page asking again for a lease it already holds is told again:
            // it may be a reconnect that lost track of its own state.
            (before != after || want).then_some(after)
        };
        if let Some(holder) = changed {
            let _ = self.tx.send(PlusEvent::Lease { name, holder });
        }
        if panel {
            self.follow_panel();
        }
    }

    /// Take a lease from whoever holds it — **Take over**, for an operator who
    /// has walked to another machine. The page it was taken from stays in line
    /// and has it back when this one lets go.
    pub fn lease_take(&self, name: String, client: ClientId) {
        if name.len() > 128 {
            return;
        }
        let holder = {
            let mut leases = self.leases.lock().unwrap();
            let queue = leases.entry(name.clone()).or_default();
            queue.retain(|&c| c != client);
            queue.insert(0, client);
            Some(client)
        };
        let panel = name == SPEED_EDITOR_LEASE;
        let _ = self.tx.send(PlusEvent::Lease { name, holder });
        if panel {
            self.follow_panel();
        }
    }

    pub fn lease_holder(&self, name: &str) -> Option<ClientId> {
        self.leases.lock().unwrap().get(name).and_then(|q| q.first().copied())
    }

    /// Every lease a client held is handed on, and every link it had open is
    /// released — a page that closes must not keep a router connection alive.
    pub fn client_gone(&self, client: ClientId) {
        let names: Vec<String> = self.leases.lock().unwrap().keys().cloned().collect();
        for name in names {
            self.lease(name, client, false);
        }
        let keys: Vec<String> = self.links.lock().unwrap().keys().cloned().collect();
        for key in keys {
            self.link_close(&key, client);
        }
    }

    // ---- links ----

    pub fn link_open(self: &Arc<Self>, key: String, host: String, port: u16, client: ClientId) {
        let mut links = self.links.lock().unwrap();
        if let Some(link) = links.get_mut(&key) {
            link.clients.insert(client);
            return;
        }
        if links.len() >= LINKS_MAX || host.is_empty() || port == 0 {
            let _ = self.tx.send(PlusEvent::Ext { key, ev: "error", data: "refused".into() });
            return;
        }
        let (out, rx) = mpsc::unbounded_channel();
        let task = tokio::spawn(run_link(self.tx.clone(), key.clone(), host, port, rx));
        links.insert(key, Link { out, clients: HashSet::from([client]), task });
    }

    pub fn link_close(&self, key: &str, client: ClientId) {
        let mut links = self.links.lock().unwrap();
        let empty = match links.get_mut(key) {
            Some(link) => {
                link.clients.remove(&client);
                link.clients.is_empty()
            }
            None => false,
        };
        if empty {
            if let Some(link) = links.remove(key) {
                link.task.abort();
                let _ = self.tx.send(PlusEvent::Ext { key: key.into(), ev: "closed", data: String::new() });
            }
        }
    }

    pub fn link_send(&self, key: &str, data: String) {
        if let Some(link) = self.links.lock().unwrap().get(key) {
            let _ = link.out.send(data.into_bytes());
        }
    }

    /// Tell every page something (`{what: …}`), as the OSC status is told.
    pub fn note(&self, body: Value) {
        let _ = self.tx.send(PlusEvent::Note(body));
    }

    // ---- the Speed Editor ----

    /// What every page is told about the panel: its state, and whether some
    /// page drives it (a page knows from its own lease whether that is itself).
    pub fn panel_note(&self) -> Value {
        self.panel_note_of(self.speed_editor.state())
    }

    fn panel_note_of(&self, state: speed_editor::State) -> Value {
        json!({
            "what": SPEED_EDITOR_NOTE,
            "state": state,
            "driven": self.lease_holder(SPEED_EDITOR_LEASE).is_some(),
        })
    }

    /// A page wants to see the panel: start looking for it, and tell everyone
    /// what was found.
    pub fn panel_watch(&self) {
        self.speed_editor.watch();
        self.note(self.panel_note());
    }

    /// Lamps and the wheel's mode, from the page driving the panel. Any other
    /// page's are dropped: it lost the panel to a Take over, and its own idea
    /// of what is lit is no longer the operator's.
    pub fn panel_write(&self, client: ClientId, reports: Vec<Vec<u8>>) {
        if self.lease_holder(SPEED_EDITOR_LEASE) != Some(client) {
            return;
        }
        let reports: Vec<Vec<u8>> = reports
            .into_iter()
            .filter(|r| !r.is_empty() && r.len() <= PANEL_REPORT_MAX)
            .take(PANEL_WRITE_MAX)
            .collect();
        if !reports.is_empty() {
            self.speed_editor.write(reports);
        }
    }

    /// The panel is open while some page holds the driver lease, and only then.
    fn follow_panel(&self) {
        self.speed_editor.want(self.lease_holder(SPEED_EDITOR_LEASE).is_some());
        self.note(self.panel_note());
    }

    /// From the panel's thread: its state to everyone, its reports to the driver.
    fn panel_event(&self, ev: speed_editor::Event) {
        match ev {
            speed_editor::Event::State(state) => self.note(self.panel_note_of(state)),
            speed_editor::Event::Report(bytes) => {
                if let Some(to) = self.lease_holder(SPEED_EDITOR_LEASE) {
                    // An event, not state: the page must not replay it to a
                    // listener that arrives late, or a key is pressed twice.
                    let body = json!({ "what": "speed-editor.report", "event": true, "r": bytes });
                    let _ = self.tx.send(PlusEvent::To { to, body });
                }
            }
        }
    }

    // ---- the thumbnail relay ----

    /// A LiveCore input's snapshot as a JPEG, fetched from the processor at
    /// most once per [`SNAP_TTL`] however many pages ask.
    ///
    /// The processor serves `/assets/Snapshots/capture_in_<n>.bmp` from its own
    /// HTTP server — named .bmp, a PNG inside (NeXtage 16). Every open page
    /// used to fetch every input itself every three seconds; this is one fetch
    /// per tick for all of them, and a JPEG a fraction of the size, which is
    /// what makes thumbnails bearable over a tailnet.
    pub async fn snapshot(&self, n: u32) -> Result<Vec<u8>, String> {
        if !(1..=24).contains(&n) {
            return Err("no such input".into());
        }
        if self.hub.family().name() != "livecore" {
            return Err("only a LiveCore serves input snapshots".into());
        }
        let addr = self.hub.device_addr();
        let host = addr.rsplit_once(':').map(|(h, _)| h.to_string()).unwrap_or(addr);
        if host.is_empty() {
            return Err("no processor configured".into());
        }
        let mut snaps = self.snaps.lock().await;
        if let Some(s) = snaps.get(&n) {
            if s.at.elapsed() < SNAP_TTL {
                return Ok(s.jpeg.clone());
            }
        }
        let png = http_get(&host, 80, &format!("/assets/Snapshots/capture_in_{n}.bmp")).await?;
        let jpeg = tokio::task::spawn_blocking(move || to_jpeg(&png))
            .await
            .map_err(|e| e.to_string())??;
        snaps.insert(n, Snap { at: std::time::Instant::now(), jpeg: jpeg.clone() });
        Ok(jpeg)
    }

    // ---- OSC ----

    pub fn osc_status(&self) -> Value {
        self.osc.lock().unwrap().status.clone()
    }

    fn set_osc_status(&self, status: Value) {
        self.osc.lock().unwrap().status = status.clone();
        let _ = self.tx.send(PlusEvent::Note(json!({ "what": "osc", "status": status })));
    }

    /// (Re)bind the OSC listener to what the shared config says.
    fn apply_osc_config(self: &Arc<Self>) {
        let cfg = self.kv_get(OSC_CONFIG_KEY).unwrap_or(Value::Null);
        let enabled = cfg.get("enabled").and_then(Value::as_bool).unwrap_or(false);
        let port = cfg.get("port").and_then(Value::as_u64).unwrap_or(0) as u16;
        // Loopback unless asked: a desk on the LAN needs 0.0.0.0, but that is a
        // decision about the venue network the operator makes, not a default.
        let lan = cfg.get("lan").and_then(Value::as_bool).unwrap_or(false);
        let mut st = self.osc.lock().unwrap();
        if let Some(t) = st.task.take() {
            t.abort();
        }
        st.port = port;
        if !enabled || port == 0 {
            st.status = json!({ "listening": false });
            drop(st);
            self.set_osc_status(json!({ "listening": false }));
            return;
        }
        let addr: SocketAddr = if lan { ([0, 0, 0, 0], port).into() } else { ([127, 0, 0, 1], port).into() };
        let me = self.clone();
        st.task = Some(tokio::spawn(async move { me.run_osc(addr).await }));
    }

    async fn run_osc(self: Arc<Self>, addr: SocketAddr) {
        let sock = match UdpSocket::bind(addr).await {
            Ok(s) => s,
            Err(e) => {
                self.set_osc_status(json!({ "listening": false, "error": format!("cannot listen on {addr}: {e}") }));
                return;
            }
        };
        self.set_osc_status(json!({ "listening": true, "addr": addr.to_string(), "count": 0 }));
        let mut buf = vec![0u8; 65536];
        let mut count: u64 = 0;
        loop {
            let Ok((n, from)) = sock.recv_from(&mut buf).await else { continue };
            let mut msgs = Vec::new();
            if let Err(e) = osc::parse_packet(&buf[..n], &mut msgs, 0) {
                self.set_osc_status(json!({ "listening": true, "addr": addr.to_string(), "count": count,
                    "last": format!("{from}: unreadable packet ({e})") }));
                continue;
            }
            for (path, args) in msgs {
                count += 1;
                let outcome = self.dispatch_osc(&path, &args);
                self.set_osc_status(json!({ "listening": true, "addr": addr.to_string(), "count": count,
                    "last": format!("{path} {} — {outcome}", osc::show_args(&args)) }));
            }
        }
    }

    /// What an OSC message does. Returns a word for the status line.
    fn dispatch_osc(&self, path: &str, args: &[Value]) -> String {
        let Some(rest) = path.strip_prefix("/openrcs/") else {
            return "ignored (not /openrcs/…)".into();
        };
        // Variables are written here, with no page needed: the same set the
        // Inspector sends. A LiveCore holds a preset-element write until GCupd,
        // so one follows, as `Store._noteEdit` does in the page.
        if let Some(m) = rest.strip_prefix("set/") {
            let nums: Vec<i64> = args.iter().filter_map(num).collect();
            let Some((&v, idx)) = nums.split_last() else { return "set needs a value".into() };
            let idx: Vec<u32> = idx.iter().map(|&x| x.max(0) as u32).collect();
            return match self.hub.set(m, &idx, v) {
                Ok(()) => {
                    if (m.starts_with("PR") || m.starts_with("PN")) && self.hub.set("GCupd", &[], 1).is_ok() {
                        "set + GCupd".into()
                    } else {
                        "set".into()
                    }
                }
                Err(e) => format!("refused: {e}"),
            };
        }
        if rest == "raw" {
            return match args.first().and_then(Value::as_str) {
                Some(line) => {
                    self.hub.raw(format!("{}\n", line.trim_end()));
                    "sent".into()
                }
                None => "raw needs a string".into(),
            };
        }
        // Everything else is the surface's own verb.
        match self.lease_holder(OSC_ACTIONS_LEASE) {
            Some(to) => {
                let _ = self.tx.send(PlusEvent::Action { to, name: rest.to_string(), args: args.to_vec() });
                "forwarded".into()
            }
            None => "dropped — no openrcs page is open to run it".into(),
        }
    }
}

fn num(v: &Value) -> Option<i64> {
    v.as_i64().or_else(|| v.as_f64().map(|f| f.round() as i64)).or_else(|| v.as_bool().map(i64::from))
}

/// A bare HTTP/1.0 GET: the processor's web server is simple, the one file
/// asked for is small, and a client library for it would be most of the
/// binary. Returns the body of a 200, or why not.
async fn http_get(host: &str, port: u16, path: &str) -> Result<Vec<u8>, String> {
    let fetch = async {
        let mut s = TcpStream::connect((host, port)).await.map_err(|e| e.to_string())?;
        s.write_all(format!("GET {path} HTTP/1.0\r\nHost: {host}\r\nConnection: close\r\n\r\n").as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        let mut buf = Vec::new();
        s.read_to_end(&mut buf).await.map_err(|e| e.to_string())?;
        Ok::<_, String>(buf)
    };
    let buf = timeout(Duration::from_secs(3), fetch).await.map_err(|_| "the processor did not answer in 3 s".to_string())??;
    let split = buf.windows(4).position(|w| w == b"\r\n\r\n").ok_or("no HTTP header")?;
    let head = String::from_utf8_lossy(&buf[..split]);
    let status = head.split_whitespace().nth(1).unwrap_or("");
    if status != "200" {
        return Err(format!("the processor answered {status}"));
    }
    Ok(buf[split + 4..].to_vec())
}

/// Whatever image the processor sent (a PNG in practice), as a JPEG.
fn to_jpeg(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let img = image::load_from_memory(bytes).map_err(|e| format!("not a picture: {e}"))?;
    let rgb = img.to_rgb8();
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, SNAP_QUALITY)
        .encode_image(&rgb)
        .map_err(|e| e.to_string())?;
    Ok(out)
}

/// One TCP link: connect, relay both ways, reconnect after a drop, until the
/// last page lets go (the task is aborted then).
async fn run_link(tx: broadcast::Sender<PlusEvent>, key: String, host: String, port: u16, mut rx: mpsc::UnboundedReceiver<Vec<u8>>) {
    let ev = |ev: &'static str, data: String| {
        let _ = tx.send(PlusEvent::Ext { key: key.clone(), ev, data });
    };
    loop {
        let conn = timeout(Duration::from_secs(5), TcpStream::connect((host.as_str(), port))).await;
        let stream = match conn {
            Ok(Ok(s)) => s,
            Ok(Err(e)) => {
                ev("error", format!("{host}:{port}: {e}"));
                sleep(Duration::from_secs(3)).await;
                continue;
            }
            Err(_) => {
                ev("error", format!("{host}:{port}: no answer in 5 s"));
                sleep(Duration::from_secs(3)).await;
                continue;
            }
        };
        let _ = stream.set_nodelay(true);
        ev("open", String::new());
        let (mut rd, mut wr) = stream.into_split();
        let mut buf = vec![0u8; 16384];
        loop {
            tokio::select! {
                n = rd.read(&mut buf) => match n {
                    Ok(0) | Err(_) => break,
                    Ok(n) => ev("data", String::from_utf8_lossy(&buf[..n]).into_owned()),
                },
                out = rx.recv() => match out {
                    Some(bytes) => if wr.write_all(&bytes).await.is_err() { break },
                    None => return,
                },
            }
        }
        ev("closed", "connection dropped".into());
        sleep(Duration::from_secs(2)).await;
    }
}

/// OSC 1.0, as much as a control surface needs: messages and bundles with
/// `i f s h d T F N` arguments. Bundle timetags are ignored — everything runs
/// on arrival.
pub mod osc {
    use serde_json::{json, Value};

    fn pad4(n: usize) -> usize {
        (n + 3) & !3
    }

    fn read_str(b: &[u8], at: &mut usize) -> Result<String, &'static str> {
        let start = *at;
        let end = b[start..].iter().position(|&c| c == 0).ok_or("unterminated string")? + start;
        let s = std::str::from_utf8(&b[start..end]).map_err(|_| "string is not UTF-8")?.to_string();
        *at = start + pad4(end - start + 1);
        if *at > b.len() {
            return Err("string runs past the end");
        }
        Ok(s)
    }

    fn take<const N: usize>(b: &[u8], at: &mut usize) -> Result<[u8; N], &'static str> {
        let s = b.get(*at..*at + N).ok_or("argument runs past the end")?;
        *at += N;
        Ok(s.try_into().unwrap())
    }

    pub fn parse_packet(b: &[u8], out: &mut Vec<(String, Vec<Value>)>, depth: u8) -> Result<(), &'static str> {
        if depth > 8 {
            return Err("bundles nested too deep");
        }
        if b.starts_with(b"#bundle\0") {
            let mut at = 16; // "#bundle\0" + 8-byte timetag
            while at + 4 <= b.len() {
                let len = u32::from_be_bytes(take::<4>(b, &mut at)?) as usize;
                let el = b.get(at..at + len).ok_or("bundle element runs past the end")?;
                parse_packet(el, out, depth + 1)?;
                at += len;
            }
            return Ok(());
        }
        let mut at = 0;
        let path = read_str(b, &mut at)?;
        if !path.starts_with('/') {
            return Err("not an OSC address");
        }
        let tags = if at < b.len() { read_str(b, &mut at)? } else { ",".into() };
        let mut args = Vec::new();
        for t in tags.chars().skip(1) {
            args.push(match t {
                'i' => json!(i32::from_be_bytes(take::<4>(b, &mut at)?)),
                'f' => json!(f32::from_be_bytes(take::<4>(b, &mut at)?) as f64),
                'h' => json!(i64::from_be_bytes(take::<8>(b, &mut at)?)),
                'd' => json!(f64::from_be_bytes(take::<8>(b, &mut at)?)),
                's' | 'S' => json!(read_str(b, &mut at)?),
                'T' => json!(true),
                'F' => json!(false),
                'N' | 'I' => Value::Null,
                'b' => {
                    let len = u32::from_be_bytes(take::<4>(b, &mut at)?) as usize;
                    at += pad4(len);
                    Value::Null
                }
                _ => return Err("unknown type tag"),
            });
        }
        out.push((path, args));
        Ok(())
    }

    pub fn show_args(args: &[Value]) -> String {
        args.iter().map(|a| a.to_string()).collect::<Vec<_>>().join(" ")
    }
}

#[cfg(test)]
mod tests {
    use super::osc::parse_packet;
    use serde_json::json;

    fn msg(path: &str, tags: &str, payload: &[u8]) -> Vec<u8> {
        let mut b = Vec::new();
        for s in [path, tags] {
            b.extend_from_slice(s.as_bytes());
            b.push(0);
            while b.len() % 4 != 0 {
                b.push(0);
            }
        }
        b.extend_from_slice(payload);
        b
    }

    #[test]
    fn a_message_with_int_float_and_string_arguments() {
        let mut p = Vec::new();
        p.extend_from_slice(&3i32.to_be_bytes());
        p.extend_from_slice(&0.5f32.to_be_bytes());
        p.extend_from_slice(b"go\0\0");
        let mut out = Vec::new();
        parse_packet(&msg("/openrcs/take", ",ifs", &p), &mut out, 0).unwrap();
        assert_eq!(out, vec![("/openrcs/take".to_string(), vec![json!(3), json!(0.5), json!("go")])]);
    }

    #[test]
    fn a_bundle_carries_each_of_its_messages() {
        let a = msg("/openrcs/cue/go", ",", &[]);
        let b = msg("/openrcs/set/PRinp", ",iiii", &[0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 5]);
        let mut bundle = b"#bundle\0".to_vec();
        bundle.extend_from_slice(&[0, 0, 0, 0, 0, 0, 0, 1]);
        for m in [&a, &b] {
            bundle.extend_from_slice(&(m.len() as u32).to_be_bytes());
            bundle.extend_from_slice(m);
        }
        let mut out = Vec::new();
        parse_packet(&bundle, &mut out, 0).unwrap();
        assert_eq!(out.len(), 2);
        assert_eq!(out[1].1, vec![json!(0), json!(1), json!(2), json!(5)]);
    }

    #[test]
    fn a_truncated_packet_is_an_error_not_a_panic() {
        let full = msg("/openrcs/take", ",i", &1i32.to_be_bytes());
        for n in 0..full.len() {
            let mut out = Vec::new();
            let _ = parse_packet(&full[..n], &mut out, 0);
        }
    }

    #[tokio::test]
    async fn a_lease_holder_asking_again_keeps_it() {
        let hub = crate::hub::Hub::start(None);
        let dir = std::env::temp_dir().join(format!("openrcs-plus-test-{}", std::process::id()));
        let plus = super::Plus::start(hub, dir.join("plugin-data.json"));
        plus.lease("x.y".into(), 1, true);
        plus.lease("x.y".into(), 2, true);
        assert_eq!(plus.lease_holder("x.y"), Some(1));
        plus.lease("x.y".into(), 1, true);
        assert_eq!(plus.lease_holder("x.y"), Some(1), "re-asking must not give the lease away");
        plus.client_gone(1);
        assert_eq!(plus.lease_holder("x.y"), Some(2), "a page that goes hands it on");
        plus.lease("x.y".into(), 2, false);
        assert_eq!(plus.lease_holder("x.y"), None);
    }

    #[tokio::test]
    async fn shared_data_survives_a_restart() {
        let dir = std::env::temp_dir().join(format!("openrcs-kv-test-{}", std::process::id()));
        let path = dir.join("plugin-data.json");
        let _ = std::fs::remove_file(&path);
        let plus = super::Plus::start(crate::hub::Hub::start(None), path.clone());
        plus.kv_set("layer-names.names".into(), serde_json::json!({ "0.1": "Lectern" }));
        plus.kv_set("nodot".into(), serde_json::json!(1));
        let again = super::Plus::start(crate::hub::Hub::start(None), path);
        assert_eq!(again.kv_get("layer-names.names"), Some(serde_json::json!({ "0.1": "Lectern" })));
        assert_eq!(again.kv_get("nodot"), None, "a key that is not <plugin>.<name> is refused");
    }

    #[test]
    fn a_png_becomes_a_smaller_jpeg() {
        let mut png = Vec::new();
        let img = image::RgbaImage::from_fn(256, 144, |x, y| image::Rgba([(x % 256) as u8, (y * 2) as u8, 128, 255]));
        img.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png).unwrap();
        let jpeg = super::to_jpeg(&png).unwrap();
        assert_eq!(&jpeg[..2], &[0xFF, 0xD8]);
        assert!(super::to_jpeg(b"not a picture").is_err());
    }

    /// The bridge's half of the Speed Editor, against a fake panel: the driver
    /// lease opens and closes it, only the driver hears its keys and lights its
    /// lamps, and Take over moves all of that to another page.
    #[tokio::test]
    async fn the_panel_follows_the_driver_lease_and_answers_only_its_holder() {
        use crate::speed_editor::{fake, Timing};
        use std::time::{Duration, Instant};

        fn until(what: &str, check: impl Fn() -> bool) {
            let end = Instant::now() + Duration::from_secs(3);
            while !check() {
                assert!(Instant::now() < end, "timed out waiting for: {what}");
                std::thread::sleep(Duration::from_millis(5));
            }
        }
        /// The next report the bridge sent, and who to.
        fn next_report(rx: &mut tokio::sync::broadcast::Receiver<super::PlusEvent>) -> (super::ClientId, Vec<u64>) {
            let end = Instant::now() + Duration::from_secs(3);
            loop {
                match rx.try_recv() {
                    Ok(super::PlusEvent::To { to, body }) if body["what"] == "speed-editor.report" => {
                        let bytes = body["r"].as_array().unwrap().iter().map(|b| b.as_u64().unwrap()).collect();
                        return (to, bytes);
                    }
                    Ok(_) => {}
                    Err(_) => {
                        assert!(Instant::now() < end, "no report");
                        std::thread::sleep(Duration::from_millis(5));
                    }
                }
            }
        }

        let panel = fake::panel();
        let plugged = std::sync::Arc::new(std::sync::Mutex::new(vec![panel.clone()]));
        let timing = Timing { scan: Duration::from_millis(10), retry: Duration::from_millis(20), read_ms: 2 };
        let dir = std::env::temp_dir().join(format!("openrcs-panel-test-{}", std::process::id()));
        let plus = super::Plus::start_with(crate::hub::Hub::start(None), dir.join("plugin-data.json"), Ok(fake::backend(plugged)), timing);
        let mut rx = plus.subscribe();
        let lease = super::SPEED_EDITOR_LEASE;

        plus.panel_watch();
        until("found", || plus.speed_editor.state().present);
        assert_eq!(panel.lock().unwrap().opens, 0, "watching opens nothing");
        assert_eq!(plus.panel_note()["driven"], false);

        plus.lease(lease.into(), 1, true);
        until("answered", || plus.speed_editor.state().authed);
        plus.lease(lease.into(), 2, true);
        assert_eq!(plus.lease_holder(lease), Some(1), "the second page waits in line");
        assert_eq!(plus.panel_note()["driven"], true);

        fake::press(&panel, &[0x0f]);
        assert_eq!(next_report(&mut rx), (1, vec![4, 0x0f, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));

        plus.panel_write(2, vec![vec![2, 1, 0, 0, 0]]);
        plus.panel_write(1, vec![vec![2, 2, 0, 0, 0], vec![], vec![0; 65]]);
        until("the driver's lamp", || !panel.lock().unwrap().written.is_empty());
        std::thread::sleep(Duration::from_millis(20));
        assert_eq!(panel.lock().unwrap().written, vec![vec![2, 2, 0, 0, 0]], "only the driver's, and only well-formed");

        plus.lease_take(lease.into(), 2);
        assert_eq!(plus.lease_holder(lease), Some(2));
        fake::press(&panel, &[0x33]);
        assert_eq!(next_report(&mut rx).0, 2, "taken over");

        plus.client_gone(2);
        assert_eq!(plus.lease_holder(lease), Some(1), "the page it was taken from has it back");
        assert!(plus.speed_editor.state().connected, "and the panel stayed open");

        plus.client_gone(1);
        until("let go", || !panel.lock().unwrap().open);
        until("says so", || !plus.speed_editor.state().connected);
        assert_eq!(plus.panel_note()["driven"], false);
    }

    #[tokio::test]
    async fn without_hid_the_panel_says_why() {
        let dir = std::env::temp_dir().join(format!("openrcs-nohid-test-{}", std::process::id()));
        let plus = super::Plus::start_with(crate::hub::Hub::start(None), dir.join("plugin-data.json"), Err("no HID here".into()), Default::default());
        plus.lease(super::SPEED_EDITOR_LEASE.into(), 1, true);
        let note = plus.panel_note();
        assert_eq!(note["state"]["available"], false);
        assert_eq!(note["state"]["reason"], "no HID here");
        assert_eq!(note["state"]["connected"], false);
    }

    #[test]
    fn a_message_with_no_type_tags_has_no_arguments() {
        let mut out = Vec::new();
        parse_packet(b"/openrcs/cue/go\0", &mut out, 0).unwrap();
        assert_eq!(out, vec![("/openrcs/cue/go".to_string(), vec![])]);
    }
}
