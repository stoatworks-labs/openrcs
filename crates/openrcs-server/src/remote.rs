//! Remote access: this surface reached over Tailscale or ZeroTier without
//! binding it to the venue LAN.
//!
//! Ported from LivePremier Plus's `remote-access` plugin. The bridge normally
//! listens on loopback; this opens the other ways in, as a setting a page
//! turns on (`remote-access.config` in the shared data, see plus.rs):
//!
//! * **Tailscale HTTPS** (`tailscale serve`) — the better way. tailscaled
//!   terminates TLS for `https://<machine>.<tailnet>.ts.net/` with a real
//!   certificate and proxies to the loopback listener. An https page is a
//!   *secure context*, so Web MIDI, audio input (LTC) and WebHID work from the
//!   remote browser too, which plain http on anything but localhost never
//!   gives. Needs HTTPS certificates switched on for the tailnet, once.
//! * **Tailnet address** — a second listener on this host's 100.x address at
//!   the surface's own port. Plain http; works on any tailnet.
//! * **ZeroTier** — a listener on each address this host holds on an
//!   authorised network. Addresses come and go as a controller authorises the
//!   node, so the listeners are reconciled on a timer.
//!
//! Serving is a setting. *Membership* — joining or leaving a ZeroTier network,
//! like tailnet up/down in tailnet.rs — changes the host's networking and is
//! only allowed on a bridge started with `--tailnet` (the appliance gate).
//!
//! Neither network is authentication for this surface, and the surface has
//! none: anyone who can reach it can drive the processor. The tailnet's ACLs
//! or the ZeroTier controller's rules are the access control.

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tokio::process::Command;
use tokio::task::JoinHandle;
use tokio::time::{interval, timeout, Duration};

use crate::plus::{Plus, PlusEvent};

pub const CONFIG_KEY: &str = "remote-access.config";
const RECONCILE: Duration = Duration::from_secs(15);
const CLI_TIMEOUT: Duration = Duration::from_secs(20);
/// The HTTPS ports `tailscale serve` accepts.
const HTTPS_PORTS: [u16; 3] = [443, 8443, 10000];

pub struct Remote {
    plus: Arc<Plus>,
    router: axum::Router,
    /// The surface's own listener; the extra doors use the same port.
    listen: SocketAddr,
    doors: Mutex<HashMap<IpAddr, (JoinHandle<()>, &'static str)>>,
    /// The HTTPS port this process put a `tailscale serve` on.
    serving: Mutex<Option<u16>>,
    status: Mutex<Value>,
}

/// One CLI run: stdout on success, the tool's own first line otherwise.
async fn cli(bin: &str, args: &[String]) -> Result<String, String> {
    let mut cmd = Command::new(bin);
    cmd.args(args).kill_on_drop(true);
    match timeout(CLI_TIMEOUT, cmd.output()).await {
        Err(_) => Err(format!("{bin} did not answer in time")),
        Ok(Err(e)) if e.kind() == std::io::ErrorKind::NotFound => Err(format!("{bin} is not installed on this host")),
        Ok(Err(e)) => Err(format!("could not run {bin}: {e}")),
        Ok(Ok(out)) => {
            let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
            if out.status.success() {
                return Ok(stdout);
            }
            let text = format!("{}\n{stdout}", String::from_utf8_lossy(&out.stderr));
            Err(text.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("failed").to_string())
        }
    }
}

/// `tailscale status --json`: state, name, addresses, and whether HTTPS
/// certificates are on (CertDomains) — which `serve` needs.
pub fn parse_tailscale(json: &str) -> Value {
    let v: Value = serde_json::from_str(json).unwrap_or(Value::Null);
    json!({
        "state": v["BackendState"].as_str().unwrap_or(""),
        "name": v["Self"]["DNSName"].as_str().unwrap_or("").trim_end_matches('.'),
        "addresses": v["Self"]["TailscaleIPs"].as_array().cloned().unwrap_or_default(),
        "https": v["CertDomains"].as_array().map(|a| !a.is_empty()).unwrap_or(false),
    })
}

/// Who serves an HTTPS port in `tailscale serve status --json`: the proxy
/// target of its root handler, `(other)` for anything else there, or None.
pub fn serve_holder(json: &str, port: u16) -> Option<String> {
    let v: Value = serde_json::from_str(json).ok()?;
    let key = port.to_string();
    let tcp = v["TCP"].get(&key).is_some();
    let web = v["Web"].as_object().and_then(|w| w.iter().find(|(k, _)| k.ends_with(&format!(":{key}"))).map(|(_, v)| v.clone()));
    if !tcp && web.is_none() {
        return None;
    }
    let handlers = web.as_ref().and_then(|w| w["Handlers"].as_object().cloned()).unwrap_or_default();
    if handlers.len() == 1 {
        if let Some(p) = handlers.get("/").and_then(|h| h["Proxy"].as_str()) {
            return Some(p.to_string());
        }
    }
    Some("(other)".into())
}

/// `zerotier-cli -j listnetworks`: id, name, status and the addresses held.
pub fn parse_zerotier(json: &str) -> Vec<Value> {
    let v: Value = serde_json::from_str(json).unwrap_or(Value::Null);
    v.as_array()
        .map(|nets| {
            nets.iter()
                .map(|n| {
                    let addrs: Vec<String> = n["assignedAddresses"]
                        .as_array()
                        .map(|a| a.iter().filter_map(|x| x.as_str()).map(|s| s.split('/').next().unwrap_or("").to_string()).collect())
                        .unwrap_or_default();
                    json!({ "id": n["nwid"].as_str().unwrap_or(""), "name": n["name"].as_str().unwrap_or(""),
                            "status": n["status"].as_str().unwrap_or(""), "addresses": addrs })
                })
                .collect()
        })
        .unwrap_or_default()
}

pub fn valid_network_id(s: &str) -> bool {
    s.len() == 16 && s.chars().all(|c| c.is_ascii_hexdigit())
}

impl Remote {
    pub fn start(plus: Arc<Plus>, router: axum::Router, listen: SocketAddr) -> Arc<Self> {
        let me = Arc::new(Self {
            plus,
            router,
            listen,
            doors: Mutex::new(HashMap::new()),
            serving: Mutex::new(None),
            status: Mutex::new(json!({})),
        });
        let r = me.clone();
        tokio::spawn(async move {
            let mut rx = r.plus.subscribe();
            let mut tick = interval(RECONCILE);
            loop {
                tokio::select! {
                    _ = tick.tick() => r.reconcile().await,
                    ev = rx.recv() => match ev {
                        Ok(PlusEvent::Kv { k, .. }) if k == CONFIG_KEY => r.reconcile().await,
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
                        _ => {}
                    },
                }
            }
        });
        me
    }

    pub fn status(&self) -> Value {
        self.status.lock().unwrap().clone()
    }

    fn config(&self) -> (String, u16, bool) {
        let c = self.plus.kv_get(CONFIG_KEY).unwrap_or(Value::Null);
        let ts = match c["tailscale"].as_str() {
            Some(m @ ("serve" | "bind")) => m.to_string(),
            _ => "off".into(),
        };
        let https = c["httpsPort"].as_u64().map(|p| p as u16).filter(|p| HTTPS_PORTS.contains(p)).unwrap_or(443);
        (ts, https, c["zerotier"].as_bool().unwrap_or(false))
    }

    /// Bring the listeners and the serve into line with the setting.
    pub async fn reconcile(&self) {
        let (ts_mode, https, zt_on) = self.config();
        let wildcard = self.listen.ip().is_unspecified();
        // Off, with nothing of ours left up: touch no CLI at all. An ordinary
        // desktop install must not shell out to tailscale every 15 seconds.
        if ts_mode == "off" && !zt_on && self.serving.lock().unwrap().is_none() && self.doors.lock().unwrap().is_empty() {
            let status = json!({ "mode": "off", "zerotier": false, "wildcard": wildcard, "doors": [] });
            if *self.status.lock().unwrap() != status {
                *self.status.lock().unwrap() = status.clone();
                self.plus.note(json!({ "what": "remote", "status": status }));
            }
            return;
        }
        let ts = cli("tailscale", &["status".into(), "--json".into()]).await;
        let ts_status = match &ts {
            Ok(j) => parse_tailscale(j),
            // `status` exits non-zero while logged out but still prints JSON.
            Err(e) => json!({ "state": "", "error": e }),
        };
        let zt = if zt_on { cli("zerotier-cli", &["-j".into(), "listnetworks".into()]).await } else { Ok("[]".into()) };
        let zt_nets = zt.as_ref().map(|j| parse_zerotier(j)).unwrap_or_default();

        // ---- tailscale serve ----
        let mut serve_err = String::new();
        let target = format!("http://127.0.0.1:{}", self.listen.port());
        let was = *self.serving.lock().unwrap();
        if let Some(p) = was {
            if ts_mode != "serve" || p != https {
                // Only ever take down what points at us.
                let holder = cli("tailscale", &["serve".into(), "status".into(), "--json".into()]).await.ok().and_then(|j| serve_holder(&j, p));
                if holder.as_deref() == Some(target.as_str()) {
                    if let Err(e) = cli("tailscale", &["serve".into(), format!("--https={p}"), "off".into()]).await {
                        serve_err = e;
                    }
                }
                *self.serving.lock().unwrap() = None;
            }
        }
        if ts_mode == "serve" && self.serving.lock().unwrap().is_none() {
            if !self.listen.ip().is_loopback() && !wildcard {
                serve_err = "tailscale serve proxies to loopback; start the bridge on 127.0.0.1".into();
            } else {
                let holder = cli("tailscale", &["serve".into(), "status".into(), "--json".into()]).await.ok().and_then(|j| serve_holder(&j, https));
                match holder {
                    Some(h) if h != target => serve_err = format!("HTTPS port {https} is already serving {h} — pick another port"),
                    _ => match cli("tailscale", &["serve".into(), "--bg".into(), "--yes".into(), format!("--https={https}"), target.clone()]).await {
                        Ok(_) => *self.serving.lock().unwrap() = Some(https),
                        Err(e) => serve_err = e,
                    },
                }
            }
        }

        // ---- doors ----
        let mut wanted: HashMap<IpAddr, &'static str> = HashMap::new();
        if !wildcard {
            if ts_mode == "bind" {
                for a in ts_status["addresses"].as_array().cloned().unwrap_or_default() {
                    if let Some(ip) = a.as_str().and_then(|s| s.parse().ok()) {
                        wanted.insert(ip, "tailscale");
                    }
                }
            }
            if zt_on {
                for n in &zt_nets {
                    if n["status"] != "OK" {
                        continue;
                    }
                    for a in n["addresses"].as_array().cloned().unwrap_or_default() {
                        if let Some(ip) = a.as_str().and_then(|s| s.parse().ok()) {
                            wanted.insert(ip, "zerotier");
                        }
                    }
                }
            }
        }
        let mut door_errs = Vec::new();
        {
            let mut doors = self.doors.lock().unwrap();
            doors.retain(|ip, (task, _)| {
                let keep = wanted.contains_key(ip) && !task.is_finished();
                if !keep {
                    task.abort();
                }
                keep
            });
            for (ip, via) in &wanted {
                if doors.contains_key(ip) {
                    continue;
                }
                let addr = SocketAddr::new(*ip, self.listen.port());
                // Bound synchronously so a refusal (the address is in the
                // CLI's answer a moment before the interface carries it) is
                // reported now and simply retried on the next pass.
                match std::net::TcpListener::bind(addr).and_then(|l| l.set_nonblocking(true).map(|_| l)) {
                    Ok(l) => {
                        let router = self.router.clone();
                        let task = tokio::spawn(async move {
                            if let Ok(l) = tokio::net::TcpListener::from_std(l) {
                                let _ = axum::serve(l, router).await;
                            }
                        });
                        doors.insert(*ip, (task, via));
                    }
                    Err(e) => door_errs.push(format!("{addr}: {e}")),
                }
            }
        }
        let doors: Vec<Value> = self
            .doors
            .lock()
            .unwrap()
            .iter()
            .map(|(ip, (_, via))| json!({ "url": format!("http://{}/", SocketAddr::new(*ip, self.listen.port())), "via": via }))
            .collect();
        let serving = *self.serving.lock().unwrap();
        let name = ts_status["name"].as_str().unwrap_or("").to_string();
        let status = json!({
            "mode": ts_mode, "httpsPort": https, "zerotier": zt_on, "wildcard": wildcard,
            "tailscale": ts_status,
            "serveUrl": serving.filter(|_| !name.is_empty()).map(|p| if p == 443 { format!("https://{name}/") } else { format!("https://{name}:{p}/") }),
            "serveError": serve_err,
            "zerotierNetworks": zt_nets,
            "zerotierError": zt.err().unwrap_or_default(),
            "doors": doors,
            "doorErrors": door_errs,
        });
        *self.status.lock().unwrap() = status.clone();
        self.plus.note(json!({ "what": "remote", "status": status }));
    }

    /// Join or leave a ZeroTier network. Appliance only — the caller checks.
    pub async fn zerotier(&self, join: bool, id: &str) -> Result<(), String> {
        let id = id.trim().to_ascii_lowercase();
        if !valid_network_id(&id) {
            return Err("a ZeroTier network id is sixteen hex digits".into());
        }
        cli("zerotier-cli", &[if join { "join" } else { "leave" }.into(), id]).await.map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serve_status_names_the_holder_of_a_port() {
        let j = r#"{"TCP":{"443":{"HTTPS":true}},"Web":{"box.tail.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:8730"}}}}}"#;
        assert_eq!(serve_holder(j, 443).as_deref(), Some("http://127.0.0.1:8730"));
        assert_eq!(serve_holder(j, 8443), None);
        let other = r#"{"Web":{"box:443":{"Handlers":{"/docs":{"Path":"/srv"}}}}}"#;
        assert_eq!(serve_holder(other, 443).as_deref(), Some("(other)"));
    }

    #[test]
    fn zerotier_networks_keep_bare_addresses() {
        let j = r#"[{"nwid":"8056c2e21c000001","name":"venue","status":"OK","assignedAddresses":["10.147.17.5/24","fd80::1/88"]}]"#;
        let n = parse_zerotier(j);
        assert_eq!(n[0]["addresses"], json!(["10.147.17.5", "fd80::1"]));
        assert!(valid_network_id("8056c2e21c000001"));
        assert!(!valid_network_id("8056c2e21c00000"));
        assert!(!valid_network_id("-056c2e21c000001"));
    }

    #[test]
    fn tailscale_status_says_whether_https_is_on() {
        let j = r#"{"BackendState":"Running","Self":{"DNSName":"panel.tail.ts.net.","TailscaleIPs":["100.1.2.3"]},"CertDomains":["panel.tail.ts.net"]}"#;
        let s = parse_tailscale(j);
        assert_eq!(s["name"], "panel.tail.ts.net");
        assert_eq!(s["https"], true);
    }
}
