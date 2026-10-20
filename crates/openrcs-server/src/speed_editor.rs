//! The DaVinci Resolve Speed Editor, held by the bridge rather than the page.
//!
//! ## Why here, and not WebHID in the page
//!
//! The first port opened the panel from the page over WebHID, as LivePremier
//! Plus first did, and on LivePremier Plus's first real panel (2026-09-24, USB,
//! Chrome on macOS) it could not get past the handshake. Chrome's
//! `receiveFeatureReport` reads at the length of the *largest* feature report
//! the device declares — 33 bytes, the serial number in report 8 — whatever
//! report it is reading, and the panel refuses a read of a shorter report at
//! that length (`IOHIDDeviceGetReport` 0xE0005000). The 10-byte challenge in
//! report 6 could never be read, and a page has no way to ask for less. hidapi
//! reads at the length it is told, and the handshake below then passes; that
//! is LivePremier Plus e25b85e, proven on the panel in 35c8abe.
//!
//! WebHID had a second fault this does not: the panel has no stable identity
//! to Chrome, so every re-enumeration lost the grant. Here it is found by
//! vendor and product id on every plug-in.
//!
//! ## What this does, and what it leaves to the page
//!
//! It finds the panel, answers its challenge and keeps the answer renewed, and
//! moves bytes: input reports out as [`Event::Report`], output reports (the
//! lamps, the wheel's mode) in through [`Link::write`]. It decodes nothing but
//! the battery. The mapping — which key does what, which lamps are lit — stays
//! in the page (`web/plugins/speed-editor/plugin.js`), because that is where
//! the store and the take logic are, and the bridge has neither on purpose.
//!
//! ## Held only while it is wanted
//!
//! Nothing touches HID until a page asks ([`Link::watch`], [`Link::want`]).
//! From then the panel is looked for, which is how a page can say "found"
//! without anything holding it; it is opened only while a page drives it
//! (`plus.rs` follows the driver lease) and let go when none does, so DaVinci
//! Resolve or anything else can have it the rest of the time.
//!
//! ## Shared, not seized
//!
//! The device is opened non-exclusively (`hid.rs`), as it has to be on macOS
//! for anyone else to see it. DaVinci Resolve opening it too would answer the
//! same challenge and hear the same keys, so both apps would act on every
//! press: quit Resolve first.
//!
//! The protocol is Sylvain Munaut's reverse engineering (blackmagic-misc,
//! bmd.py, Apache-2.0), the same that awj-surface's `speed-editor.js` carries
//! for the page — see ATTRIBUTIONS.md.

use std::sync::mpsc::{self, RecvTimeoutError, Sender, TryRecvError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::hid::{Backend, Device, Found, Opener};

pub const VENDOR_ID: u16 = 0x1edb;
pub const PRODUCT_ID: u16 = 0xda0e;

/// The handshake's feature report, both ways, and its one length.
const REPORT_AUTH: u8 = 0x06;
const AUTH_LEN: usize = 10;
/// Input report: charging flag, then level 0..100.
const IN_BATTERY: u8 = 0x07;

// ------------------------------------------------------------- the handshake

const AUTH_EVEN: [u64; 8] = [
    0x3ae1206f97c10bc8, 0x2a9ab32bebf244c6, 0x20a6f8b8df9adf0a, 0xaf80ece52cfc1719,
    0xec2ee2f7414fd151, 0xb055adfd73344a15, 0xa63d2e3059001187, 0x751bf623f42e0dde,
];
const AUTH_ODD: [u64; 8] = [
    0x3e22b34f502e7fde, 0x24656b981875ab1c, 0xa17f3456df7bf8c3, 0x6df72e1941aef698,
    0x72226f011e66ab94, 0x3831a3c606296b42, 0xfd7ff81881332c89, 0x61a3f6474ff236c6,
];
const AUTH_MASK: u64 = 0xa79a63f585d37bf0;

/// bmd.py's `rol8`, which turns the other way to its name: a byte to the right.
fn rol8(v: u64) -> u64 {
    v.rotate_right(8)
}

/// The host's answer to the panel's 64-bit challenge.
pub fn auth_response(challenge: u64) -> u64 {
    let n = (challenge & 7) as usize;
    let mut v = challenge.rotate_right(8 * n as u32);
    let k = if (v & 1) == ((0x78 >> n) & 1) {
        AUTH_EVEN[n]
    } else {
        v ^= rol8(v);
        AUTH_ODD[n]
    };
    v ^ (rol8(v) & AUTH_MASK) ^ k
}

/// A 10-byte AUTH feature report: id, step, then a little-endian u64.
fn auth_packet(step: u8, value: u64) -> [u8; AUTH_LEN] {
    let mut out = [0u8; AUTH_LEN];
    out[0] = REPORT_AUTH;
    out[1] = step;
    out[2..].copy_from_slice(&value.to_le_bytes());
    out
}

fn read_auth(dev: &dyn Device) -> Result<Vec<u8>, String> {
    // At the report's own length — the whole reason this is not WebHID.
    let r = dev.get_feature(REPORT_AUTH, AUTH_LEN)?;
    if r.len() < AUTH_LEN {
        return Err(format!("a {}-byte answer to the handshake, not {AUTH_LEN}", r.len()));
    }
    Ok(r)
}

/// Run the handshake. The panel sends no input reports until it has been
/// answered, and stops again when the answer expires: this returns the number
/// of seconds until then, and it must be run again before that.
///
/// The panel also offers to authenticate itself to the host; its answer is
/// read and not checked, as nothing is gained by checking it.
pub fn authenticate(dev: &dyn Device) -> Result<u16, String> {
    dev.send_feature(&auth_packet(0, 0))?; // reset the state machine
    let challenge = read_auth(dev)?;
    dev.send_feature(&auth_packet(1, 0))?; // our challenge to it
    read_auth(dev)?; // its answer, unchecked
    let challenge = u64::from_le_bytes(challenge[2..10].try_into().unwrap());
    dev.send_feature(&auth_packet(3, auth_response(challenge)))?;
    let status = read_auth(dev)?;
    if status[1] != 0x04 {
        return Err("the panel refused the answer".into());
    }
    Ok(u16::from_le_bytes([status[2], status[3]]))
}

// ------------------------------------------------------------------ the link

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Battery {
    pub charging: bool,
    pub level: u8,
}

/// What the page is told about the panel.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct State {
    /// Whether this build can reach HID at all, and if not, why not.
    pub available: bool,
    pub reason: Option<String>,
    /// Looking for the panel: a page has asked since the bridge started.
    pub watching: bool,
    /// A panel is plugged in, whether or not it is open.
    pub present: bool,
    /// Open, because a page is driving it.
    pub connected: bool,
    /// Answered: it is sending reports.
    pub authed: bool,
    /// Seconds the last answer was good for.
    pub lease: Option<u16>,
    pub product: Option<String>,
    pub battery: Option<Battery>,
    pub error: Option<String>,
    /// Successful handshakes since the bridge started. A page sets the lamps
    /// and the wheel's mode again when it moves: a panel that has been
    /// unplugged has forgotten both.
    pub handshakes: u32,
}

pub enum Event {
    State(State),
    /// One input report, id in byte 0.
    Report(Vec<u8>),
}

#[derive(Clone, Copy)]
pub struct Timing {
    /// How often to look for a panel that is not open. Enumerating is cheap,
    /// and a panel plugged in should be answered within a breath.
    pub scan: Duration,
    /// After a failed handshake: soon, but not so soon that it hammers a panel
    /// still coming up after being plugged in.
    pub retry: Duration,
    /// How long one read waits before the link looks at its commands again —
    /// the most a lamp waits behind a quiet panel.
    pub read_ms: i32,
}

impl Default for Timing {
    fn default() -> Self {
        Self { scan: Duration::from_secs(2), retry: Duration::from_secs(5), read_ms: 20 }
    }
}

enum Cmd {
    Want(bool),
    Write(Vec<Vec<u8>>),
}

pub type OnEvent = Arc<dyn Fn(Event) + Send + Sync>;

/// The bridge's handle on the panel. The panel itself lives on a thread of its
/// own, started by the first page that asks, which owns the HID handle and
/// exits when this is dropped.
pub struct Link {
    state: Arc<Mutex<State>>,
    opener: Mutex<Option<Opener>>,
    cmd: Mutex<Option<Sender<Cmd>>>,
    on_event: OnEvent,
    timing: Timing,
}

impl Link {
    pub fn new(opener: Result<Opener, String>, timing: Timing, on_event: OnEvent) -> Self {
        let state = State { available: opener.is_ok(), reason: opener.as_ref().err().cloned(), ..State::default() };
        Self {
            state: Arc::new(Mutex::new(state)),
            opener: Mutex::new(opener.ok()),
            cmd: Mutex::new(None),
            on_event,
            timing,
        }
    }

    pub fn state(&self) -> State {
        self.state.lock().unwrap().clone()
    }

    /// Start looking for the panel, if nothing has yet. Opens nothing.
    pub fn watch(&self) {
        let mut cmd = self.cmd.lock().unwrap();
        if cmd.is_some() {
            return;
        }
        let Some(opener) = self.opener.lock().unwrap().take() else { return };
        let (tx, rx) = mpsc::channel();
        *cmd = Some(tx);
        self.state.lock().unwrap().watching = true;
        let state = self.state.clone();
        let emit = self.on_event.clone();
        let timing = self.timing;
        let spawned = std::thread::Builder::new().name("speed-editor".into()).spawn(move || {
            let backend = match opener() {
                Ok(b) => b,
                Err(reason) => {
                    eprintln!("speed editor: {reason}");
                    let s = {
                        let mut s = state.lock().unwrap();
                        s.available = false;
                        s.watching = false;
                        s.reason = Some(reason);
                        s.clone()
                    };
                    emit(Event::State(s));
                    return;
                }
            };
            Worker { backend, open: None, wanted: false, next_scan: Instant::now(), state, emit, t: timing }.run(rx);
        });
        if let Err(e) = spawned {
            eprintln!("speed editor: could not start its thread: {e}");
            let mut s = self.state.lock().unwrap();
            s.available = false;
            s.watching = false;
            s.reason = Some(format!("could not start the panel's thread: {e}"));
        }
    }

    /// Open the panel (a page is driving it), or let it go (none is).
    pub fn want(&self, wanted: bool) {
        if wanted {
            self.watch();
        }
        if let Some(tx) = self.cmd.lock().unwrap().as_ref() {
            let _ = tx.send(Cmd::Want(wanted));
        }
    }

    /// Output reports, id in byte 0. Dropped while nobody could hear them;
    /// says whether they were passed on.
    pub fn write(&self, reports: Vec<Vec<u8>>) -> bool {
        if !self.state.lock().unwrap().authed {
            return false;
        }
        match self.cmd.lock().unwrap().as_ref() {
            Some(tx) => tx.send(Cmd::Write(reports)).is_ok(),
            None => false,
        }
    }
}

struct Opened {
    dev: Box<dyn Device>,
    /// When to run the handshake again: at half the lease, or after a refusal.
    renew_at: Instant,
}

struct Worker {
    backend: Box<dyn Backend>,
    open: Option<Opened>,
    wanted: bool,
    next_scan: Instant,
    state: Arc<Mutex<State>>,
    emit: OnEvent,
    t: Timing,
}

impl Worker {
    fn run(mut self, rx: mpsc::Receiver<Cmd>) {
        loop {
            loop {
                match rx.try_recv() {
                    Ok(cmd) => self.command(cmd),
                    Err(TryRecvError::Empty) => break,
                    // The bridge let go of the link: let go of the panel.
                    Err(TryRecvError::Disconnected) => return,
                }
            }
            if self.open.is_some() {
                self.service();
                continue;
            }
            if Instant::now() >= self.next_scan {
                self.scan();
                if self.open.is_some() {
                    continue;
                }
            }
            match rx.recv_timeout(self.next_scan.saturating_duration_since(Instant::now())) {
                Ok(cmd) => self.command(cmd),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
    }

    /// Change the state, and tell the bridge if that changed anything. The
    /// lock is let go first: the bridge reads the state back.
    fn update(&self, f: impl FnOnce(&mut State)) {
        let changed = {
            let mut s = self.state.lock().unwrap();
            let before = s.clone();
            f(&mut s);
            (*s != before).then(|| s.clone())
        };
        if let Some(s) = changed {
            (self.emit)(Event::State(s));
        }
    }

    fn fail(&self, message: String) {
        let fresh = self.state.lock().unwrap().error.as_deref() != Some(message.as_str());
        if fresh {
            eprintln!("speed editor: {message}");
        }
        self.update(|s| s.error = Some(message));
    }

    fn command(&mut self, cmd: Cmd) {
        match cmd {
            Cmd::Want(wanted) => {
                if self.wanted == wanted {
                    return;
                }
                self.wanted = wanted;
                if !wanted && self.open.is_some() {
                    eprintln!("speed editor: let the panel go: no page is driving it");
                    self.close();
                }
                self.next_scan = Instant::now();
            }
            Cmd::Write(reports) => {
                let Some(open) = &self.open else { return };
                if !self.state.lock().unwrap().authed {
                    return;
                }
                for r in reports {
                    if let Err(e) = open.dev.write(&r) {
                        eprintln!("speed editor: a write failed: {e}");
                    }
                }
            }
        }
    }

    fn scan(&mut self) {
        self.next_scan = Instant::now() + self.t.scan;
        let found = match self.backend.find(VENDOR_ID, PRODUCT_ID) {
            Ok(list) => list.into_iter().next(),
            Err(e) => return self.fail(format!("could not list HID devices: {e}")),
        };
        self.update(|s| {
            s.present = found.is_some();
            if let Some(f) = &found {
                s.product = f.product.clone();
            }
        });
        if let (Some(found), true) = (found, self.wanted) {
            self.open_panel(found);
        }
    }

    fn open_panel(&mut self, found: Found) {
        let dev = match self.backend.open(&found.path) {
            Ok(d) => d,
            Err(e) => return self.fail(format!("could not open the panel: {e} — is DaVinci Resolve holding it?")),
        };
        eprintln!("speed editor: opened {}", found.product.as_deref().unwrap_or("the panel"));
        self.open = Some(Opened { dev, renew_at: Instant::now() });
        self.update(|s| {
            s.connected = true;
            s.error = None;
        });
        self.handshake();
    }

    fn handshake(&mut self) {
        let Some(open) = &mut self.open else { return };
        match authenticate(&*open.dev) {
            Ok(lease) => {
                // Renew at half the lease, as node-blackmagic-controller does.
                let secs = if lease == 0 { 600 } else { lease };
                open.renew_at = Instant::now() + Duration::from_millis(u64::from(secs) * 500);
                self.update(|s| {
                    s.authed = true;
                    s.lease = Some(lease);
                    s.error = None;
                    s.handshakes += 1;
                });
            }
            Err(e) => {
                open.renew_at = Instant::now() + self.t.retry;
                self.update(|s| s.authed = false);
                self.fail(format!("the panel would not authenticate: {e}"));
            }
        }
    }

    /// One read, then the handshake if it is due.
    fn service(&mut self) {
        let Some(open) = &self.open else { return };
        match open.dev.read(self.t.read_ms) {
            Ok(Some(bytes)) => self.report(bytes),
            Ok(None) => {}
            Err(e) => return self.lost(e),
        }
        if self.open.as_ref().is_some_and(|o| Instant::now() >= o.renew_at) {
            self.handshake();
        }
    }

    fn report(&self, bytes: Vec<u8>) {
        if bytes.first() == Some(&IN_BATTERY) && bytes.len() >= 3 {
            let battery = Battery { charging: bytes[1] != 0, level: bytes[2] };
            self.update(|s| s.battery = Some(battery));
        }
        (self.emit)(Event::Report(bytes));
    }

    /// Unplugged, or asleep: let go, and look again.
    fn lost(&mut self, why: String) {
        eprintln!("speed editor: panel gone ({why})");
        self.close();
        self.update(|s| s.present = false);
        self.next_scan = Instant::now() + self.t.scan;
    }

    fn close(&mut self) {
        // Dropping the handle closes it.
        self.open = None;
        self.update(|s| {
            s.connected = false;
            s.authed = false;
            s.lease = None;
            s.battery = None;
        });
    }
}

#[cfg(test)]
pub(crate) mod fake {
    //! A Speed Editor as hidapi presents one. It runs the real handshake: it
    //! issues a challenge, checks the answer, and says nothing until it has
    //! been answered, as the hardware does. It refuses a feature read at any
    //! length but the report's own, which is what the real panel does on macOS
    //! and why WebHID could never read the challenge.

    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use super::{auth_response, PRODUCT_ID, VENDOR_ID};
    use crate::hid::{Backend, Device, Found, Opener};

    pub struct Panel {
        pub challenge: u64,
        pub refuse: bool,
        /// Seconds the panel says an answer is good for.
        pub lease: u16,
        step: Option<u8>,
        pub authed: bool,
        pub reads: Vec<(u8, usize)>,
        pub written: Vec<Vec<u8>>,
        inbox: VecDeque<Vec<u8>>,
        pub open: bool,
        pub opens: u32,
        /// Unplugged: every call on an open handle fails.
        pub gone: bool,
    }

    pub type Shared = Arc<Mutex<Panel>>;

    pub fn panel() -> Shared {
        Arc::new(Mutex::new(Panel {
            challenge: 0x0123456789abcdef,
            refuse: false,
            lease: 600,
            step: None,
            authed: false,
            reads: Vec::new(),
            written: Vec::new(),
            inbox: VecDeque::new(),
            open: false,
            opens: 0,
            gone: false,
        }))
    }

    /// The panel says something — heard only once it has been answered.
    pub fn press(p: &Shared, codes: &[u16]) {
        let mut r = vec![0u8; 13];
        r[0] = 4;
        for (i, c) in codes.iter().enumerate() {
            r[1 + 2 * i..3 + 2 * i].copy_from_slice(&c.to_le_bytes());
        }
        p.lock().unwrap().inbox.push_back(r);
    }

    pub fn say(p: &Shared, report: Vec<u8>) {
        p.lock().unwrap().inbox.push_back(report);
    }

    /// The machine's USB ports: whatever panels are in `plugged` now.
    pub fn backend(plugged: Arc<Mutex<Vec<Shared>>>) -> Opener {
        Box::new(move || Ok(Box::new(Ports(plugged)) as Box<dyn Backend>))
    }

    struct Ports(Arc<Mutex<Vec<Shared>>>);

    impl Backend for Ports {
        fn find(&mut self, vid: u16, pid: u16) -> Result<Vec<Found>, String> {
            assert_eq!((vid, pid), (VENDOR_ID, PRODUCT_ID));
            let n = self.0.lock().unwrap().len();
            Ok((0..n).map(|i| Found { path: format!("panel-{i}"), product: Some("DaVinci Resolve Speed Editor".into()) }).collect())
        }

        fn open(&mut self, path: &str) -> Result<Box<dyn Device>, String> {
            let i: usize = path.strip_prefix("panel-").and_then(|n| n.parse().ok()).ok_or("no such path")?;
            let p = self.0.lock().unwrap().get(i).cloned().ok_or("no such device")?;
            {
                let mut panel = p.lock().unwrap();
                panel.open = true;
                panel.opens += 1;
            }
            Ok(Box::new(Handle(p)))
        }
    }

    pub struct Handle(pub Shared);

    impl Drop for Handle {
        fn drop(&mut self) {
            let mut p = self.0.lock().unwrap();
            p.open = false;
            // An unplugged panel forgets it was answered.
            p.authed = false;
        }
    }

    impl Device for Handle {
        fn send_feature(&self, b: &[u8]) -> Result<(), String> {
            let mut p = self.0.lock().unwrap();
            if p.gone {
                return Err("device disconnected".into());
            }
            if b[0] != 6 {
                return Err(format!("feature report {} is not the handshake", b[0]));
            }
            p.step = Some(b[1]);
            if b[1] == 3 {
                let v = u64::from_le_bytes(b[2..10].try_into().unwrap());
                p.authed = !p.refuse && v == auth_response(p.challenge);
            }
            Ok(())
        }

        fn get_feature(&self, id: u8, len: usize) -> Result<Vec<u8>, String> {
            let mut p = self.0.lock().unwrap();
            p.reads.push((id, len));
            if p.gone {
                return Err("device disconnected".into());
            }
            // The real panel on macOS: refused at any other length.
            if id != 6 || len != 10 {
                return Err("IOHIDDeviceGetReport failed: (0xE0005000)".into());
            }
            let mut out = vec![0u8; 10];
            out[0] = 6;
            match p.step {
                Some(0) => out[2..].copy_from_slice(&p.challenge.to_le_bytes()),
                Some(1) => out[1] = 2,
                Some(3) => {
                    out[1] = if p.authed { 4 } else { 0 };
                    out[2..4].copy_from_slice(&p.lease.to_le_bytes());
                }
                _ => {}
            }
            Ok(out)
        }

        fn read(&self, ms: i32) -> Result<Option<Vec<u8>>, String> {
            {
                let mut p = self.0.lock().unwrap();
                if p.gone {
                    return Err("could not read from HID device".into());
                }
                if p.authed {
                    if let Some(r) = p.inbox.pop_front() {
                        return Ok(Some(r));
                    }
                }
            }
            std::thread::sleep(Duration::from_millis(ms.max(0) as u64));
            Ok(None)
        }

        fn write(&self, b: &[u8]) -> Result<(), String> {
            let mut p = self.0.lock().unwrap();
            if p.gone {
                return Err("device disconnected".into());
            }
            p.written.push(b.to_vec());
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    use super::fake::{self, Shared};
    use super::*;

    /// The answers awj-surface's `authResponse` gives — the JavaScript that
    /// LivePremier Plus answered a real panel with (35c8abe).
    #[test]
    fn the_answer_is_the_one_the_real_panel_accepted() {
        for (challenge, answer) in [
            (0x0123456789abcdef_u64, 0xe5c7b689e9967608_u64),
            (0x0000000000000000, 0x3ae1206f97c10bc8),
            (0xffffffffffffffff, 0x61a3f6474ff236c6),
            (0x8000000000000007, 0xf51bf623f42e0a5e),
            (0x1122334455667788, 0xabd3311ac6f61e30),
            (0xdeadbeefcafef00d, 0x6a04b6fcff2b4b21),
            (0x0000000000000003, 0x6df72d1b40aef698),
            (0xa5a5a5a5a5a5a5a5, 0xb07029fd5310ce10),
        ] {
            assert_eq!(auth_response(challenge), answer, "challenge {challenge:#018x}");
        }
    }

    /// What Chrome does: every feature read at the largest report's length.
    struct AsChromeReads(fake::Handle);

    impl Device for AsChromeReads {
        fn send_feature(&self, b: &[u8]) -> Result<(), String> {
            self.0.send_feature(b)
        }
        fn get_feature(&self, id: u8, _len: usize) -> Result<Vec<u8>, String> {
            self.0.get_feature(id, 33)
        }
        fn read(&self, ms: i32) -> Result<Option<Vec<u8>>, String> {
            self.0.read(ms)
        }
        fn write(&self, b: &[u8]) -> Result<(), String> {
            self.0.write(b)
        }
    }

    #[test]
    fn a_challenge_read_at_the_largest_reports_length_is_refused_as_webhid_found() {
        let p = fake::panel();
        let err = authenticate(&AsChromeReads(fake::Handle(p.clone()))).unwrap_err();
        assert!(err.contains("0xE0005000"), "{err}");
        let handle = fake::Handle(p.clone());
        assert_eq!(authenticate(&handle), Ok(600), "and at the report's own length it passes");
        assert!(p.lock().unwrap().authed);
    }

    const FAST: Timing = Timing { scan: Duration::from_millis(10), retry: Duration::from_millis(20), read_ms: 2 };

    struct Rig {
        link: Link,
        plugged: Arc<Mutex<Vec<Shared>>>,
        reports: Arc<Mutex<Vec<Vec<u8>>>>,
        states: Arc<Mutex<Vec<State>>>,
    }

    fn rig(panels: Vec<Shared>) -> Rig {
        let plugged = Arc::new(Mutex::new(panels));
        let reports = Arc::new(Mutex::new(Vec::new()));
        let states = Arc::new(Mutex::new(Vec::new()));
        let (r, s) = (reports.clone(), states.clone());
        let on_event: OnEvent = Arc::new(move |ev| match ev {
            Event::Report(b) => r.lock().unwrap().push(b),
            Event::State(st) => s.lock().unwrap().push(st),
        });
        let link = Link::new(Ok(fake::backend(plugged.clone())), FAST, on_event);
        Rig { link, plugged, reports, states }
    }

    fn until(what: &str, check: impl Fn() -> bool) {
        let end = Instant::now() + Duration::from_secs(3);
        while Instant::now() < end {
            if check() {
                return;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        panic!("timed out waiting for: {what}");
    }

    #[test]
    fn nothing_is_touched_until_a_page_asks() {
        let p = fake::panel();
        let r = rig(vec![p.clone()]);
        std::thread::sleep(Duration::from_millis(40));
        assert!(!r.link.state().watching);
        assert!(!r.link.state().present, "not even looked for");
        assert_eq!(p.lock().unwrap().opens, 0);
    }

    #[test]
    fn the_link_finds_the_panel_opens_it_only_when_wanted_and_answers_at_the_reports_own_length() {
        let p = fake::panel();
        let r = rig(vec![p.clone()]);
        r.link.watch();
        until("found", || r.link.state().present);
        std::thread::sleep(Duration::from_millis(40));
        assert!(!r.link.state().connected, "not held while nobody wants it");
        assert_eq!(p.lock().unwrap().opens, 0);

        r.link.want(true);
        until("answered", || r.link.state().authed);
        let s = r.link.state();
        assert_eq!((s.connected, s.lease, s.handshakes), (true, Some(600), 1));
        assert_eq!(s.product.as_deref(), Some("DaVinci Resolve Speed Editor"));
        let reads = p.lock().unwrap().reads.clone();
        assert!(reads.iter().all(|&(id, len)| id == 6 && len == 10), "read {reads:?}");

        fake::press(&p, &[0x0f]);
        until("CUT reported", || !r.reports.lock().unwrap().is_empty());
        assert_eq!(&r.reports.lock().unwrap()[0][..3], &[4, 0x0f, 0]);

        assert!(r.link.write(vec![vec![2, 1, 0, 0, 0], vec![4, 1]]));
        until("lamps written", || p.lock().unwrap().written.len() == 2);
        assert_eq!(p.lock().unwrap().written[0], vec![2, 1, 0, 0, 0]);

        r.link.want(false);
        until("let go", || !p.lock().unwrap().open);
        until("says so", || !r.link.state().connected);
        assert!(r.link.state().present, "still plugged in");
        assert!(!r.link.write(vec![vec![2, 0, 0, 0, 0]]), "nothing to write to");
    }

    #[test]
    fn a_refused_answer_is_reported_and_retried_and_nothing_is_written_meanwhile() {
        let p = fake::panel();
        p.lock().unwrap().refuse = true;
        let r = rig(vec![p.clone()]);
        r.link.want(true);
        until("refusal reported", || r.link.state().error.is_some_and(|e| e.contains("would not authenticate")));
        assert!(!r.link.state().authed);
        let attempts = p.lock().unwrap().reads.len();
        until("tried again", || p.lock().unwrap().reads.len() > attempts);
        assert!(!r.link.write(vec![vec![2, 0, 0, 0, 0]]));
        assert!(p.lock().unwrap().written.is_empty());

        p.lock().unwrap().refuse = false;
        until("answered at last", || r.link.state().authed);
        assert_eq!(r.link.state().error, None);
    }

    #[test]
    fn a_replugged_panel_is_found_and_answered_again() {
        let first = fake::panel();
        let r = rig(vec![first.clone()]);
        r.link.want(true);
        until("answered", || r.link.state().handshakes == 1);

        r.plugged.lock().unwrap().clear();
        first.lock().unwrap().gone = true;
        until("gone", || !r.link.state().connected);
        assert!(!r.link.state().authed);

        let second = fake::panel();
        r.plugged.lock().unwrap().push(second.clone());
        until("answered again", || r.link.state().handshakes == 2);
        assert!(r.link.state().authed && second.lock().unwrap().open);
        fake::press(&second, &[0x33]);
        until("CAM 1 reported", || r.reports.lock().unwrap().iter().any(|b| b[1] == 0x33));
    }

    #[test]
    fn the_answer_is_renewed_before_its_lease_runs_out() {
        let p = fake::panel();
        p.lock().unwrap().lease = 1; // renewed at half: 500 ms
        let r = rig(vec![p.clone()]);
        r.link.want(true);
        until("answered", || r.link.state().handshakes == 1);
        let at = Instant::now();
        until("renewed", || r.link.state().handshakes == 2);
        assert!(at.elapsed() >= Duration::from_millis(400), "renewed at half the lease, not at once");
    }

    #[test]
    fn the_battery_is_in_the_state() {
        let p = fake::panel();
        let r = rig(vec![p.clone()]);
        r.link.want(true);
        until("answered", || r.link.state().authed);
        fake::say(&p, vec![7, 1, 64]);
        until("battery", || r.link.state().battery.is_some());
        assert_eq!(r.link.state().battery, Some(Battery { charging: true, level: 64 }));
        assert!(r.states.lock().unwrap().iter().any(|s| s.battery.is_some()), "and the bridge was told");
    }

    #[test]
    fn dropping_the_link_lets_the_panel_go() {
        let p = fake::panel();
        let r = rig(vec![p.clone()]);
        r.link.want(true);
        until("open", || r.link.state().authed);
        drop(r.link);
        until("closed", || !p.lock().unwrap().open);
    }

    #[test]
    fn without_hid_the_link_says_why_and_does_nothing() {
        let link = Link::new(Err("no HID in this build".into()), FAST, Arc::new(|_| {}));
        link.want(true);
        let s = link.state();
        assert_eq!((s.available, s.reason.as_deref(), s.watching), (false, Some("no HID in this build"), false));
        assert!(!link.write(vec![vec![2, 0, 0, 0, 0]]));
    }
}
