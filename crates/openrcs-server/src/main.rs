//! openrcs-server — bridges a browser control surface to an Analog Way
//! Midra/LiveCore processor.
//!
//! Serves the web UI over HTTP and a `/ws` websocket. The websocket carries a
//! small JSON protocol: the browser sends `set`/`get`/`scan`/`raw`, the server
//! streams back `meta`, a `snapshot`, live `val` deltas, device `err` codes,
//! and link `status`.
//!
//!     openrcs-server --device 192.0.2.10:10500 --platform livecore
//!
//! The device is optional. Started without one — the appliance case, where the
//! box boots before anyone has told it which processor it is in front of — it
//! serves the UI unconfigured and waits to be pointed at something from the
//! Setup view, then remembers that across restarts.

mod hub;

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::http::{header, HeaderValue};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use openrcs_proto::Platform;
use serde::{Deserialize, Serialize};
use tower_http::services::ServeDir;
use tower_http::set_header::SetResponseHeaderLayer;

use hub::{platform_name, DeviceEvent, Hub, Target};

#[derive(Deserialize)]
#[serde(tag = "t", rename_all = "lowercase")]
enum ClientMsg {
    Set { m: String, #[serde(default)] i: Vec<i64>, v: i64 },
    Get { m: String, #[serde(default)] i: Vec<i64> },
    Scan { m: String },
    Raw { d: String },
    /// Point the bridge at a processor, and remember it.
    Setup { device: String, platform: String },
    /// Sweep the local network for processors.
    Discover,
}

#[derive(Serialize)]
#[serde(tag = "t", rename_all = "lowercase")]
enum ServerMsg {
    Meta {
        platform: String,
        port: u16,
        host: String,
        /// Full `host:port`, empty when unconfigured. `host` stays the bare
        /// host because the browser uses it to fetch source thumbnails from the
        /// processor's own HTTP server.
        device: String,
        /// False until a processor has been chosen. The UI shows Setup and
        /// nothing else while this is false.
        configured: bool,
        vars: Vec<VarMeta>,
    },
    Snap { items: Vec<(String, Vec<i64>, i64)> },
    Val { m: String, i: Vec<i64>, v: i64 },
    Err { code: u16 },
    Status { connected: bool },
    /// A processor answered the discovery sweep.
    Found { addr: String, platform: Option<String> },
    /// The discovery sweep finished.
    Scanned,
    /// Setup was rejected — the address did not parse.
    Setuperr { reason: String },
}

#[derive(Serialize)]
struct VarMeta {
    m: &'static str,
    name: &'static str,
    group: &'static str,
    dims: &'static [u32],
    min: i64,
    max: i64,
    ro: bool,
}

struct Config {
    device: Option<String>,
    platform: Option<Platform>,
    listen: SocketAddr,
    web_dir: String,
    config_path: PathBuf,
}

/// What the Setup view writes, so a configured appliance comes back configured
/// after a power cut.
#[derive(Serialize, Deserialize, Default)]
struct StoredConfig {
    device: Option<String>,
    platform: Option<String>,
}

fn parse_args() -> Config {
    let mut device = None;
    let mut platform = None;
    let mut listen: SocketAddr = "127.0.0.1:8730".parse().unwrap();
    let mut web_dir = default_web_dir();
    let mut config_path = default_config_path();

    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--device" => device = args.next().or(device),
            "--platform" => {
                platform = match args.next().as_deref() {
                    Some("midra") => Some(Platform::Midra),
                    Some(_) => Some(Platform::LiveCore),
                    None => platform,
                }
            }
            "--listen" => {
                if let Some(v) = args.next() {
                    listen = v.parse().unwrap_or(listen);
                }
            }
            "--web" => web_dir = args.next().unwrap_or(web_dir),
            "--config" => {
                if let Some(v) = args.next() {
                    config_path = PathBuf::from(v);
                }
            }
            "-h" | "--help" => {
                eprintln!("openrcs-server [--device host:port] [--platform livecore|midra] \
                           [--listen host:port] [--web dir] [--config file]");
                eprintln!();
                eprintln!("  --device is optional. Without it the server starts unconfigured");
                eprintln!("  and takes its target from --config, or from the Setup view.");
                std::process::exit(0);
            }
            other => eprintln!("ignoring unknown arg {other}"),
        }
    }
    Config { device, platform, listen, web_dir, config_path }
}

fn default_config_path() -> PathBuf {
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("openrcs").join("config.json")
}

fn load_config(path: &std::path::Path) -> StoredConfig {
    match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_else(|e| {
            eprintln!("ignoring unreadable {}: {e}", path.display());
            StoredConfig::default()
        }),
        Err(_) => StoredConfig::default(),
    }
}

fn save_config(path: &std::path::Path, target: &Target) {
    let stored = StoredConfig {
        device: Some(target.addr.clone()),
        platform: Some(platform_name(target.platform).to_string()),
    };
    let Ok(json) = serde_json::to_string_pretty(&stored) else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Err(e) = std::fs::write(path, json) {
        // Not fatal: the appliance still works for this session, it just comes
        // back unconfigured. Say so rather than failing the setup the operator
        // just completed.
        eprintln!("could not save {}: {e}", path.display());
    }
}

fn parse_platform(s: &str) -> Platform {
    match s {
        "midra" => Platform::Midra,
        _ => Platform::LiveCore,
    }
}

/// Normalise what the Setup keypad produced into `host:port`.
///
/// A bare address is the common case — nobody wants to tap a port number on a
/// keypad — so the platform's own port is filled in.
fn normalise_device(input: &str, platform: Platform) -> Result<String, String> {
    let s = input.trim();
    if s.is_empty() {
        return Err("no address".into());
    }
    let (host, port) = match s.rsplit_once(':') {
        Some((h, p)) => {
            let port: u16 = p.parse().map_err(|_| format!("bad port {p:?}"))?;
            (h, port)
        }
        None => (s, platform.port()),
    };
    if host.is_empty() {
        return Err("no host".into());
    }
    Ok(format!("{host}:{port}"))
}

fn default_web_dir() -> String {
    // web/ sits next to the crate during development.
    let here = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("web");
    here.to_string_lossy().into_owned()
}

/// Everything a websocket client needs: the link to the processor, and where
/// to write a setup change so it survives a reboot.
struct App {
    hub: Arc<Hub>,
    config_path: PathBuf,
    /// One sweep at a time. A second Scan tap while the first is running would
    /// otherwise double the traffic and interleave two sets of results.
    scanning: AtomicBool,
}

#[tokio::main]
async fn main() {
    let cfg = parse_args();

    // Command line wins for this run; the stored config supplies whatever it
    // did not say. Neither is required — no target at all is the appliance's
    // first boot, and the Setup view fills it in.
    let stored = load_config(&cfg.config_path);
    let addr = cfg.device.clone().or(stored.device);
    let platform = cfg
        .platform
        .or_else(|| stored.platform.as_deref().map(parse_platform));
    let target = addr.map(|addr| Target {
        addr,
        platform: platform.unwrap_or(Platform::LiveCore),
    });

    let hub = Hub::start(target.clone());
    let app = Arc::new(App {
        hub: hub.clone(),
        config_path: cfg.config_path.clone(),
        scanning: AtomicBool::new(false),
    });

    // Serve the UI from disk when the source tree (or a --web dir) is present —
    // that keeps live-editing during development — otherwise fall back to the
    // copy embedded in the binary, so a release is a single self-contained file.
    let from_disk = std::path::Path::new(&cfg.web_dir).is_dir();
    let base = Router::new().route("/ws", get(ws_handler));
    let app = if from_disk {
        base.fallback_service(ServeDir::new(&cfg.web_dir))
    } else {
        base.fallback(serve_embedded)
    }
        // the control surface is served locally and iterated live — never let a
        // browser hold a stale copy of the UI.
        .layer(SetResponseHeaderLayer::overriding(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-cache, no-store, must-revalidate"),
        ))
        .with_state(app);

    println!("openrcs-server");
    match &target {
        Some(t) => println!("  device   {} ({})", t.addr, platform_name(t.platform)),
        None => println!("  device   unconfigured — set one in the Setup view"),
    }
    println!("  config   {}", cfg.config_path.display());
    println!("  web UI   http://{}/", cfg.listen);
    println!("  serving  {}", if from_disk { cfg.web_dir.as_str() } else { "embedded UI" });

    let listener = tokio::net::TcpListener::bind(cfg.listen).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn ws_handler(ws: WebSocketUpgrade, State(app): State<Arc<App>>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| client(socket, app))
}

// The web UI, baked into the binary at build time (see Cargo.toml).
#[derive(rust_embed::RustEmbed)]
#[folder = "web/"]
struct WebAssets;

/// Serve the embedded UI. Unknown paths fall back to index.html so the
/// hash-routed single-page app loads from any URL.
async fn serve_embedded(uri: axum::http::Uri) -> impl IntoResponse {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    let (data, mime) = match WebAssets::get(path) {
        Some(f) => (f.data, content_type(path)),
        None => match WebAssets::get("index.html") {
            Some(f) => (f.data, "text/html; charset=utf-8"),
            None => return (axum::http::StatusCode::NOT_FOUND, "not found").into_response(),
        },
    };
    ([(header::CONTENT_TYPE, mime)], data.into_owned()).into_response()
}

fn content_type(path: &str) -> &'static str {
    if path.ends_with(".html") {
        "text/html; charset=utf-8"
    } else if path.ends_with(".js") {
        "text/javascript; charset=utf-8"
    } else if path.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if path.ends_with(".png") {
        "image/png"
    } else if path.ends_with(".svg") {
        "image/svg+xml"
    } else {
        "application/octet-stream"
    }
}

/// Hand a browser the variable table and the current state.
///
/// Sent on connect and again after every retarget: a new target can mean a
/// different platform, so the table itself changes and the cache is empty.
async fn seed<S>(tx: &mut S, hub: &Arc<Hub>) -> Result<(), ()>
where
    S: SinkExt<Message> + Unpin,
{
    let platform = hub.platform();
    let vars: Vec<VarMeta> = platform
        .vars()
        .iter()
        .map(|v| VarMeta {
            m: v.mnemonic,
            name: v.name,
            group: v.group,
            dims: v.dims,
            min: v.min,
            max: v.max,
            ro: v.read_only,
        })
        .collect();
    let device = hub.device_addr();
    let meta = ServerMsg::Meta {
        platform: platform_name(platform).into(),
        port: platform.port(),
        // just the host: the browser fetches source thumbnails from the device's own
        // HTTP server, which is a different origin from this bridge
        host: device
            .rsplit_once(':')
            .map(|(h, _)| h.to_string())
            .unwrap_or_else(|| device.clone()),
        device,
        configured: hub.is_configured(),
        vars,
    };
    send(tx, &meta).await?;
    send(tx, &ServerMsg::Status { connected: hub.is_connected() }).await?;
    send(tx, &ServerMsg::Snap { items: hub.snapshot() }).await
}

async fn client(socket: WebSocket, app: Arc<App>) {
    let (mut tx, mut rx) = socket.split();
    let hub = app.hub.clone();

    // 1. hand the browser the variable table and the current state.
    if seed(&mut tx, &hub).await.is_err() {
        return;
    }

    // 2. fan device events out to this browser.
    let mut events = hub.subscribe();
    let hub_out = hub.clone();
    let pump_out = async move {
        loop {
            match events.recv().await {
                Ok(DeviceEvent::Retargeted) => {
                    // Everything the browser holds now describes a different
                    // device. Re-seed rather than patch.
                    if seed(&mut tx, &hub_out).await.is_err() {
                        break;
                    }
                }
                Ok(ev) => {
                    let msg = match ev {
                        DeviceEvent::Value(m, i, v) => ServerMsg::Val { m, i, v },
                        DeviceEvent::Error(code) => ServerMsg::Err { code },
                        DeviceEvent::Connected(c) => ServerMsg::Status { connected: c },
                        DeviceEvent::Discovered(addr, platform) => ServerMsg::Found {
                            addr,
                            platform: platform.map(str::to_string),
                        },
                        DeviceEvent::DiscoverDone => ServerMsg::Scanned,
                        DeviceEvent::SetupError(reason) => ServerMsg::Setuperr { reason },
                        DeviceEvent::Retargeted => unreachable!("handled above"),
                    };
                    if send(&mut tx, &msg).await.is_err() {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => break,
            }
        }
    };

    // 3. handle browser -> device.
    let app_rx = app.clone();
    let pump_in = async move {
        while let Some(Ok(msg)) = rx.next().await {
            if let Message::Text(txt) = msg {
                handle_client_msg(&app_rx, &txt);
            }
        }
    };

    tokio::select! {
        _ = pump_out => {}
        _ = pump_in => {}
    }
}

fn handle_client_msg(app: &Arc<App>, txt: &str) {
    let hub = &app.hub;
    let msg: ClientMsg = match serde_json::from_str(txt) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("bad client message: {e}");
            return;
        }
    };
    let to_u32 = |v: &[i64]| v.iter().map(|&x| x.max(0) as u32).collect::<Vec<_>>();
    match msg {
        ClientMsg::Setup { device, platform } => {
            let platform = parse_platform(&platform);
            match normalise_device(&device, platform) {
                Ok(addr) => {
                    let target = Target { addr, platform };
                    println!("setup: {} ({})", target.addr, platform_name(platform));
                    save_config(&app.config_path, &target);
                    hub.retarget(Some(target));
                }
                Err(reason) => {
                    eprintln!("setup rejected: {reason}");
                    hub.report_setup_error(reason);
                }
            }
        }
        ClientMsg::Discover => {
            if app.scanning.swap(true, Ordering::SeqCst) {
                return; // a sweep is already running
            }
            let app = app.clone();
            tokio::spawn(async move {
                hub::discover(app.hub.clone()).await;
                app.scanning.store(false, Ordering::SeqCst);
            });
        }
        ClientMsg::Set { m, i, v } => {
            if let Err(e) = hub.set(&m, &to_u32(&i), v) {
                eprintln!("set {m} rejected: {e}");
            }
        }
        ClientMsg::Get { m, i } => {
            let _ = hub.get(&m, &to_u32(&i));
        }
        ClientMsg::Scan { m } => {
            if let Err(e) = hub.scan(&m, 8192) {
                eprintln!("scan {m}: {e}");
            }
        }
        ClientMsg::Raw { d } => hub.raw(d),
    }
}

async fn send<S>(tx: &mut S, msg: &ServerMsg) -> Result<(), ()>
where
    S: SinkExt<Message> + Unpin,
{
    let json = serde_json::to_string(msg).map_err(|_| ())?;
    tx.send(Message::Text(json)).await.map_err(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bare_address_gets_the_platform_port() {
        // The keypad case: an operator taps four octets and nothing else.
        assert_eq!(
            normalise_device("192.0.2.10", Platform::LiveCore).unwrap(),
            format!("192.0.2.10:{}", Platform::LiveCore.port())
        );
        assert_eq!(
            normalise_device("192.0.2.10", Platform::Midra).unwrap(),
            format!("192.0.2.10:{}", Platform::Midra.port())
        );
    }

    #[test]
    fn an_explicit_port_is_kept() {
        assert_eq!(
            normalise_device(" 192.0.2.10:15500 ", Platform::LiveCore).unwrap(),
            "192.0.2.10:15500"
        );
    }

    #[test]
    fn nonsense_is_rejected_rather_than_dialled() {
        assert!(normalise_device("", Platform::LiveCore).is_err());
        assert!(normalise_device("192.0.2.10:", Platform::LiveCore).is_err());
        assert!(normalise_device("192.0.2.10:donkey", Platform::LiveCore).is_err());
        assert!(normalise_device(":10500", Platform::LiveCore).is_err());
    }

    #[test]
    fn stored_config_round_trips() {
        let dir = std::env::temp_dir().join(format!("openrcs-test-{}", std::process::id()));
        let path = dir.join("config.json");
        let target = Target { addr: "192.0.2.10:10500".into(), platform: Platform::Midra };
        save_config(&path, &target);
        let back = load_config(&path);
        assert_eq!(back.device.as_deref(), Some("192.0.2.10:10500"));
        assert_eq!(back.platform.as_deref(), Some("midra"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_missing_config_is_not_an_error() {
        let back = load_config(std::path::Path::new("/nonexistent/openrcs/config.json"));
        assert!(back.device.is_none());
    }
}
