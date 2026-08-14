//! Optional: show and change this host's Tailscale membership from the UI.
//!
//! Entirely off unless the server was started with `--tailnet`. That is not
//! decoration: this module runs `tailscale up`/`down` on the machine hosting
//! the bridge, so on a normal desktop install it would be a control surface for
//! something the user did not ask this program to touch. The flag is the
//! statement that this host is an appliance and the surface owns it.
//!
//! It exists for the panel case — a box with a touchscreen, no keyboard and no
//! shell, installed at a venue. "Which name is this on the tailnet, and why is
//! it not reachable" is otherwise unanswerable without a laptop and an SSH key.
//!
//! Everything shells out to the `tailscale` CLI rather than talking to
//! tailscaled's local API directly. The CLI is the stable interface, it is
//! present wherever tailscaled is, and it keeps this file small enough to read.
//!
//! Privileges: `tailscale up` normally needs root. The appliance grants the
//! account this server runs as by joining with `--operator=<user>`, which is
//! what makes the buttons here work without the bridge running as root. Without
//! that the reads still work and the writes report the CLI's own refusal.

use std::time::Duration;

use tokio::process::Command;

/// How long any one `tailscale` invocation may take.
///
/// `tailscale up` on a node with no key and no stored identity prints a login
/// URL and waits **forever**. Reached from a button on a touchscreen that would
/// be a wedged task and a button that never comes back, so every call is
/// bounded and the child is killed when the future is dropped.
const TIMEOUT: Duration = Duration::from_secs(25);

#[derive(Debug, Default, Clone, serde::Serialize)]
pub struct Status {
    /// `Running`, `NeedsLogin`, `Stopped`, `NoState`, or empty when the daemon
    /// is not answering at all — which is a different fault from being logged
    /// out, and the one people misread.
    pub state: String,
    /// MagicDNS name, e.g. `panel-a1b2c3.tail1234.ts.net.`
    pub name: String,
    pub addr: String,
}

async fn run(args: &[String]) -> Result<String, String> {
    let mut cmd = Command::new("tailscale");
    cmd.args(args).kill_on_drop(true);

    let out = match tokio::time::timeout(TIMEOUT, cmd.output()).await {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => {
            return Err(if e.kind() == std::io::ErrorKind::NotFound {
                "tailscale is not installed on this host".to_string()
            } else {
                format!("could not run tailscale: {e}")
            })
        }
        Err(_) => return Err("tailscale did not answer in time".into()),
    };

    if out.status.success() {
        return Ok(String::from_utf8_lossy(&out.stdout).into_owned());
    }

    // The CLI's own message is far more useful than anything invented here —
    // "access denied", "key has already been used", "invalid key" all say
    // exactly what to do next. Keep the first line, which is the summary.
    let err = String::from_utf8_lossy(&out.stderr);
    let first = err.lines().find(|l| !l.trim().is_empty()).unwrap_or("").trim();
    Err(if first.is_empty() { "tailscale failed".into() } else { first.to_string() })
}

fn arg(s: &str) -> String {
    s.to_string()
}

pub async fn status() -> Status {
    // A failure here is not worth surfacing as an error: "the daemon is not
    // answering" is itself the status, and an empty state renders as that.
    let Ok(json) = run(&[arg("status"), arg("--json")]).await else {
        return Status::default();
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&json) else {
        return Status::default();
    };

    let state = v["BackendState"].as_str().unwrap_or("").to_string();
    let name = v["Self"]["DNSName"].as_str().unwrap_or("").trim_end_matches('.').to_string();
    let addr = v["Self"]["TailscaleIPs"]
        .as_array()
        .and_then(|ips| ips.iter().find_map(|i| i.as_str()))
        .unwrap_or("")
        .to_string();

    Status { state, name, addr }
}

/// A name Tailscale will accept, checked here so a typo comes back as a
/// sentence rather than as the CLI's usage text.
fn valid_hostname(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 63
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        && !s.starts_with('-')
        && !s.ends_with('-')
}

pub async fn connect(authkey: &str) -> Result<(), String> {
    let key = authkey.trim();

    // Note the `--flag=value` form throughout. Arguments are passed as separate
    // argv entries so there is no shell to inject into, but a value that begins
    // with `-` would still be read as another flag in the space-separated form.
    let mut args = vec![arg("up")];
    if !key.is_empty() {
        if !key.starts_with("tskey-") {
            return Err("that is not an auth key — they begin with 'tskey-'".into());
        }
        if key.len() > 256 || !key.is_ascii() {
            return Err("that does not look like an auth key".into());
        }
        args.push(format!("--authkey={key}"));
    } else {
        // No key offered. Only safe when the node already has an identity to
        // reconnect with; otherwise `up` would sit waiting on a login URL that
        // nobody can see, until the timeout above cuts it off.
        let st = status().await;
        if st.state != "Stopped" {
            return Err(
                "this host has no Tailscale identity yet — enter an auth key to join".into(),
            );
        }
    }
    run(&args).await.map(|_| ())
}

pub async fn disconnect() -> Result<(), String> {
    // `down` only. The daemon stays running and the node keeps its identity, so
    // reconnecting is a button rather than a re-registration.
    run(&[arg("down")]).await.map(|_| ())
}

pub async fn rename(name: &str) -> Result<(), String> {
    let name = name.trim();
    if !valid_hostname(name) {
        return Err("names may use letters, digits and hyphens, and cannot start or end with one".into());
    }
    run(&[arg("set"), format!("--hostname={name}")]).await.map(|_| ())
}
