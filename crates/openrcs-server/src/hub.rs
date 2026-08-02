//! Shared state and the single connection to the device.
//!
//! One [`Hub`] owns the TCP link to the processor, a cache of the latest value
//! for every `(mnemonic, indices)` the device has reported, and a broadcast
//! channel that fans device frames out to every connected browser.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use openrcs_proto::{encode_get, encode_set, Decoder, Frame, Platform};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::{broadcast, mpsc};
use tokio::time::{sleep, Duration};

/// A single value the device reported, keyed by mnemonic + index tuple.
pub type Key = (String, Vec<i64>);

/// Fanned out to every browser client.
#[derive(Clone, Debug)]
pub enum DeviceEvent {
    /// A value update (mnemonic, indices, value).
    Value(String, Vec<i64>, i64),
    /// A device error/NAK code.
    Error(u16),
    /// Link up or down.
    Connected(bool),
}

pub struct Hub {
    pub platform: Platform,
    pub device_addr: String,
    state: Mutex<HashMap<Key, i64>>,
    to_device: mpsc::UnboundedSender<String>,
    events: broadcast::Sender<DeviceEvent>,
    connected: AtomicBool,
}

impl Hub {
    /// Build the hub and spawn the device-connection task.
    pub fn start(platform: Platform, device_addr: String) -> Arc<Self> {
        let (to_device, from_clients) = mpsc::unbounded_channel::<String>();
        let (events, _) = broadcast::channel(4096);
        let hub = Arc::new(Hub {
            platform,
            device_addr,
            state: Mutex::new(HashMap::new()),
            to_device,
            events,
            connected: AtomicBool::new(false),
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

    /// Current cache as a flat list, for a newly connected browser.
    pub fn snapshot(&self) -> Vec<(String, Vec<i64>, i64)> {
        let s = self.state.lock().unwrap();
        s.iter().map(|((m, i), v)| (m.clone(), i.clone(), *v)).collect()
    }

    /// Validate and send a set. Returns the encode error if the arguments are
    /// out of range, so the caller can report it to the browser.
    pub fn set(&self, mnem: &str, idx: &[u32], val: i64) -> Result<(), String> {
        let def = self
            .platform
            .lookup(mnem)
            .ok_or_else(|| format!("unknown mnemonic {mnem}"))?;
        def.validate(idx, val).map_err(|e| e.to_string())?;
        let _ = self.to_device.send(encode_set(self.platform, mnem, idx, val));
        Ok(())
    }

    /// Request one variable.
    pub fn get(&self, mnem: &str, idx: &[u32]) -> Result<(), String> {
        let def = self
            .platform
            .lookup(mnem)
            .ok_or_else(|| format!("unknown mnemonic {mnem}"))?;
        def.validate_indices(idx).map_err(|e| e.to_string())?;
        let _ = self.to_device.send(encode_get(self.platform, mnem, idx));
        Ok(())
    }

    /// Request every index combination of a variable, capped so a huge array
    /// can't flood the link. Returns how many gets were issued.
    pub fn scan(&self, mnem: &str, cap: usize) -> Result<usize, String> {
        let def = self
            .platform
            .lookup(mnem)
            .ok_or_else(|| format!("unknown mnemonic {mnem}"))?;
        let total: usize = def.dims.iter().map(|&d| d as usize).product::<usize>().max(1);
        if total > cap {
            return Err(format!("{mnem} has {total} entries (cap {cap})"));
        }
        let mut idx = vec![0u32; def.dims.len()];
        let mut n = 0;
        loop {
            let _ = self.to_device.send(encode_get(self.platform, mnem, &idx));
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

async fn device_loop(hub: Arc<Hub>, mut from_clients: mpsc::UnboundedReceiver<String>) {
    loop {
        match TcpStream::connect(&hub.device_addr).await {
            Ok(stream) => {
                hub.connected.store(true, Ordering::Relaxed);
                let _ = hub.events.send(DeviceEvent::Connected(true));
                if let Err(e) = pump(&hub, stream, &mut from_clients).await {
                    eprintln!("device link lost: {e}");
                }
                hub.connected.store(false, Ordering::Relaxed);
                let _ = hub.events.send(DeviceEvent::Connected(false));
            }
            Err(e) => eprintln!("connect {}: {e}", hub.device_addr),
        }
        sleep(Duration::from_secs(2)).await;
    }
}

async fn pump(
    hub: &Arc<Hub>,
    stream: TcpStream,
    from_clients: &mut mpsc::UnboundedReceiver<String>,
) -> std::io::Result<()> {
    let (mut rd, mut wr) = stream.into_split();
    let mut dec = Decoder::new();
    let mut buf = [0u8; 8192];
    loop {
        tokio::select! {
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
