//! Read-only probe against a LivePremier device.
//!
//! Connects, reads the model, then inventories screens and preset slots and
//! prints what it finds. **Get-only by construction**: the single write to the
//! socket builds its message with [`encode_get`], and `encode_replace` is not
//! imported, so no path in this file can fire a take or recall a preset. That
//! is deliberate — this is meant to be safe to run against show hardware.
//!
//!     cargo run --example awjprobe -- <device-ip> [preset-slots]

use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

use openrcs_awj::{encode_get, paths, Decoder, Frame, Transition, Value, PORT};

fn main() -> std::io::Result<()> {
    let mut args = std::env::args().skip(1);
    let host = args.next().unwrap_or_else(|| "127.0.0.1".into());
    let slots: u16 = args.next().and_then(|s| s.parse().ok()).unwrap_or(24);
    let addr = if host.contains(':') {
        host.clone()
    } else {
        format!("{host}:{PORT}")
    };

    let mut sock = TcpStream::connect(&addr)?;
    sock.set_read_timeout(Some(Duration::from_millis(1500)))?;
    println!("connected to {addr}\n");

    let mut dec = Decoder::new();
    let mut buf = [0u8; 8192];

    // One request, one reply: AWJ answers a get directly, and with an empty
    // subscription list nothing else can arrive to be confused for it.
    let mut get = |sock: &mut TcpStream, path: &str| -> std::io::Result<Option<Value>> {
        sock.write_all(encode_get(path).as_bytes())?;
        loop {
            let n = match sock.read(&mut buf) {
                Ok(0) => return Ok(None),
                Ok(n) => n,
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => return Ok(None),
                Err(e) if e.kind() == std::io::ErrorKind::TimedOut => return Ok(None),
                Err(e) => return Err(e),
            };
            // Take the first completed message: with an empty subscription
            // list the only thing that can arrive is this get's own reply.
            if let Some(f) = dec.feed(&buf[..n]).into_iter().next() {
                match f {
                    Frame::Value { value, .. } => return Ok(Some(value)),
                    Frame::Error(e) => {
                        // E12 is the normal answer for "this build has no such
                        // path", so report it and carry on rather than exiting.
                        println!("  {} {}", e.code.as_str(), e.message);
                        return Ok(None);
                    }
                }
            }
        }
    };

    let model = get(&mut sock, &paths::device_model(1))?;
    println!("model: {}", show(&model));

    println!("\nscreens");
    for s in 1..=24u8 {
        let used = get(&mut sock, &paths::screen_is_used(s))?;
        if used.as_ref().and_then(Value::as_bool) != Some(true) {
            continue;
        }
        let label = get(&mut sock, &paths::screen_label(s))?;
        let raw = get(&mut sock, &paths::screen_transition(s))?;
        let tr = raw.as_ref().and_then(Value::as_str).and_then(Transition::parse);
        let on_air = match tr {
            Some(t) if t.program_is_down() => "program is the DOWN preset",
            Some(_) => "program is the UP preset",
            None => "transition unknown",
        };
        let up = get(&mut sock, &paths::screen_take_time(s, true))?;
        let down = get(&mut sock, &paths::screen_take_time(s, false))?;
        println!(
            "  S{s:<2} {:<20} {:<16} {on_air}, take up/down {}/{} (tenths)",
            show(&label),
            show(&raw),
            show(&up),
            show(&down)
        );
    }

    println!("\npreset slots 1..{slots}");
    let mut found = 0;
    for slot in 1..=slots {
        if get(&mut sock, &paths::preset_is_valid(slot))?.and_then(|v| v.as_bool()) != Some(true) {
            continue;
        }
        let label = get(&mut sock, &paths::preset_label(slot))?;
        println!("  {slot:>4}  {}", show(&label));
        found += 1;
    }
    if found == 0 {
        println!("  (none stored)");
    }

    Ok(())
}

fn show(v: &Option<Value>) -> String {
    match v {
        Some(Value::String(s)) => s.clone(),
        Some(other) => other.to_string(),
        None => "-".into(),
    }
}
