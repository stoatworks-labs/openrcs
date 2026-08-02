//! Read-only probe against a device.
//!
//! Connects, prints whatever the device pushes on connect, issues a few
//! read-only requests, and decodes the replies with the crate's own codec.
//! Every command sent here is a GET or an identify special — nothing is
//! written to the device.
//!
//!     cargo run --example probe -- <device-ip>:10500 livecore

use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

use openrcs_proto::{encode_get, parse_frame, Frame, Platform};

fn main() -> std::io::Result<()> {
    let mut args = std::env::args().skip(1);
    let addr = args.next().unwrap_or_else(|| "127.0.0.1:10500".into());
    let platform = match args.next().as_deref() {
        Some("midra") => Platform::Midra,
        _ => Platform::LiveCore,
    };

    let mut sock = TcpStream::connect(&addr)?;
    sock.set_read_timeout(Some(Duration::from_millis(800)))?;
    println!("connected to {addr} as {platform:?}\n");

    let mut buf = [0u8; 4096];
    let mut show = |sock: &mut TcpStream| -> std::io::Result<()> {
        loop {
            match sock.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    for line in buf[..n].split(|&b| b == b'\n') {
                        let line = String::from_utf8_lossy(line);
                        let line = line.trim_end_matches('\r');
                        if line.is_empty() {
                            continue;
                        }
                        match parse_frame(line) {
                            Ok(Frame::Value(r)) => {
                                let name = platform
                                    .lookup_answer(&r.mnemonic)
                                    .map(|d| d.name)
                                    .unwrap_or("?");
                                println!("    {line:<18} -> {} {:?} = {}  [{name}]",
                                         r.mnemonic, r.indices, r.value);
                            }
                            Ok(Frame::Error(c)) => println!("    {line:<18} -> ERROR {c}"),
                            Err(_) => println!("    {line:<18} -> (unparsed)"),
                        }
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => break,
                Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => break,
                Err(e) => return Err(e),
            }
        }
        Ok(())
    };

    println!("on connect:");
    show(&mut sock)?;

    // Identify specials, then a couple of read-only gets.
    for (mnem, idx) in [("?", &[][..]), ("!", &[]), ("*", &[]), ("VEvar", &[0][..])] {
        let cmd = encode_get(platform, mnem, idx);
        println!("send {:?}", cmd.trim_end());
        sock.write_all(cmd.as_bytes())?;
        std::thread::sleep(Duration::from_millis(300));
        show(&mut sock)?;
    }

    Ok(())
}
