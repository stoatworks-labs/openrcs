//! openrcs-server — bridges a browser control surface to an Analog Way
//! Midra/LiveCore processor.
//!
//! Serves the web UI over HTTP and a `/ws` websocket. The websocket carries a
//! small JSON protocol: the browser sends `set`/`get`/`scan`/`raw`, the server
//! streams back `meta`, a `snapshot`, live `val` deltas, device `err` codes,
//! and link `status`.
//!
//!     openrcs-server --device 192.0.2.10:10500 --platform livecore

mod hub;

use std::net::SocketAddr;
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

use hub::{DeviceEvent, Hub};

#[derive(Deserialize)]
#[serde(tag = "t", rename_all = "lowercase")]
enum ClientMsg {
    Set { m: String, #[serde(default)] i: Vec<i64>, v: i64 },
    Get { m: String, #[serde(default)] i: Vec<i64> },
    Scan { m: String },
    Raw { d: String },
}

#[derive(Serialize)]
#[serde(tag = "t", rename_all = "lowercase")]
enum ServerMsg {
    Meta { platform: String, port: u16, vars: Vec<VarMeta> },
    Snap { items: Vec<(String, Vec<i64>, i64)> },
    Val { m: String, i: Vec<i64>, v: i64 },
    Err { code: u16 },
    Status { connected: bool },
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
    device: String,
    platform: Platform,
    listen: SocketAddr,
    web_dir: String,
}

fn parse_args() -> Config {
    let mut device = "127.0.0.1:10500".to_string();
    let mut platform = Platform::LiveCore;
    let mut listen: SocketAddr = "127.0.0.1:8730".parse().unwrap();
    let mut web_dir = default_web_dir();

    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--device" => device = args.next().unwrap_or(device),
            "--platform" => {
                platform = match args.next().as_deref() {
                    Some("midra") => Platform::Midra,
                    _ => Platform::LiveCore,
                }
            }
            "--listen" => {
                if let Some(v) = args.next() {
                    listen = v.parse().unwrap_or(listen);
                }
            }
            "--web" => web_dir = args.next().unwrap_or(web_dir),
            "-h" | "--help" => {
                eprintln!("openrcs-server [--device host:port] [--platform livecore|midra] \
                           [--listen host:port] [--web dir]");
                std::process::exit(0);
            }
            other => eprintln!("ignoring unknown arg {other}"),
        }
    }
    Config { device, platform, listen, web_dir }
}

fn default_web_dir() -> String {
    // web/ sits next to the crate during development.
    let here = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("web");
    here.to_string_lossy().into_owned()
}

#[tokio::main]
async fn main() {
    let cfg = parse_args();
    let hub = Hub::start(cfg.platform, cfg.device.clone());

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
        .with_state(hub);

    println!("openrcs-server");
    println!("  device   {} ({:?})", cfg.device, cfg.platform);
    println!("  web UI   http://{}/", cfg.listen);
    println!("  serving  {}", if from_disk { cfg.web_dir.as_str() } else { "embedded UI" });

    let listener = tokio::net::TcpListener::bind(cfg.listen).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn ws_handler(ws: WebSocketUpgrade, State(hub): State<Arc<Hub>>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| client(socket, hub))
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

fn platform_name(p: Platform) -> &'static str {
    match p {
        Platform::LiveCore => "livecore",
        Platform::Midra => "midra",
    }
}

async fn client(socket: WebSocket, hub: Arc<Hub>) {
    let (mut tx, mut rx) = socket.split();

    // 1. hand the browser the variable table and the current state.
    let vars: Vec<VarMeta> = hub
        .platform
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
    let meta = ServerMsg::Meta {
        platform: platform_name(hub.platform).into(),
        port: hub.platform.port(),
        vars,
    };
    if send(&mut tx, &meta).await.is_err() {
        return;
    }
    let _ = send(&mut tx, &ServerMsg::Status { connected: hub.is_connected() }).await;
    let _ = send(&mut tx, &ServerMsg::Snap { items: hub.snapshot() }).await;

    // 2. fan device events out to this browser.
    let mut events = hub.subscribe();
    let hub_rx = hub.clone();
    let pump_out = async move {
        loop {
            match events.recv().await {
                Ok(ev) => {
                    let msg = match ev {
                        DeviceEvent::Value(m, i, v) => ServerMsg::Val { m, i, v },
                        DeviceEvent::Error(code) => ServerMsg::Err { code },
                        DeviceEvent::Connected(c) => ServerMsg::Status { connected: c },
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
    let pump_in = async move {
        while let Some(Ok(msg)) = rx.next().await {
            if let Message::Text(txt) = msg {
                handle_client_msg(&hub_rx, &txt);
            }
        }
    };

    tokio::select! {
        _ = pump_out => {}
        _ = pump_in => {}
    }
}

fn handle_client_msg(hub: &Arc<Hub>, txt: &str) {
    let msg: ClientMsg = match serde_json::from_str(txt) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("bad client message: {e}");
            return;
        }
    };
    let to_u32 = |v: &[i64]| v.iter().map(|&x| x.max(0) as u32).collect::<Vec<_>>();
    match msg {
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
