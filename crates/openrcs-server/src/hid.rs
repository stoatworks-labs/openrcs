//! USB HID, for control panels plugged into the machine the bridge runs on.
//!
//! Two traits and one implementation of them. A [`Backend`] finds devices by
//! vendor and product id and opens them; a [`Device`] is one open device's
//! reports. The real backend is the `hidapi` crate, behind the `hid` feature;
//! the tests put a fake panel behind the same traits (`speed_editor.rs`).
//!
//! Nothing here knows what a panel is. The Speed Editor's handshake and its
//! reports live in `speed_editor.rs`; a second panel would be a second file
//! beside it, on these same traits.
//!
//! Both traits are blocking, as hidapi is, and are only ever used from the one
//! thread that owns the device (`speed_editor::Link`): hidapi's handles are not
//! for sharing between threads, and a panel's traffic is a few reports a second.

/// A device a scan found: where to open it, and what it calls itself.
#[derive(Clone, Debug, PartialEq)]
pub struct Found {
    pub path: String,
    pub product: Option<String>,
}

pub trait Backend {
    /// Every connected device with this vendor and product id.
    fn find(&mut self, vid: u16, pid: u16) -> Result<Vec<Found>, String>;
    /// Open one, shared: another app that has it open keeps it.
    fn open(&mut self, path: &str) -> Result<Box<dyn Device>, String>;
}

pub trait Device {
    /// Send a feature report, its id in byte 0.
    fn send_feature(&self, bytes: &[u8]) -> Result<(), String>;
    /// Read feature report `id` at exactly `len` bytes, id included. The length
    /// matters: a Speed Editor refuses a read at any other (see
    /// `speed_editor.rs`), which is the whole reason this is not WebHID.
    fn get_feature(&self, id: u8, len: usize) -> Result<Vec<u8>, String>;
    /// The next input report, id in byte 0, or `None` after `ms` with nothing.
    /// An error means the device has gone.
    fn read(&self, ms: i32) -> Result<Option<Vec<u8>>, String>;
    /// Write an output report, id in byte 0.
    fn write(&self, bytes: &[u8]) -> Result<(), String>;
}

/// Makes the backend, on the thread that will use it.
pub type Opener = Box<dyn FnOnce() -> Result<Box<dyn Backend>, String> + Send>;

/// This build's way to the machine's HID devices, or why there is none.
pub fn system() -> Result<Opener, String> {
    #[cfg(feature = "hid")]
    {
        Ok(Box::new(|| Ok(Box::new(real::Hidapi::new()?) as Box<dyn Backend>)))
    }
    #[cfg(not(feature = "hid"))]
    {
        Err("This build of openrcs-server has no USB panel support (built without the `hid` feature).".into())
    }
}

#[cfg(feature = "hid")]
mod real {
    use std::ffi::CString;

    use super::{Backend, Device, Found};

    pub struct Hidapi(hidapi::HidApi);

    impl Hidapi {
        pub fn new() -> Result<Self, String> {
            // `new` lists every device once; `find` then asks for one vendor
            // and product at a time. Listing opens nothing.
            let api = hidapi::HidApi::new().map_err(|e| format!("cannot start HID: {e}"))?;
            // macOS opens a HID device exclusively unless told otherwise, and
            // then nothing else can see it — DaVinci Resolve included. Shared,
            // as node-hid's `nonExclusive` opens it in LivePremier Plus.
            #[cfg(target_os = "macos")]
            api.set_open_exclusive(false);
            Ok(Self(api))
        }
    }

    impl Backend for Hidapi {
        fn find(&mut self, vid: u16, pid: u16) -> Result<Vec<Found>, String> {
            self.0.reset_devices().map_err(|e| e.to_string())?;
            self.0.add_devices(vid, pid).map_err(|e| e.to_string())?;
            Ok(self
                .0
                .device_list()
                .filter(|d| d.vendor_id() == vid && d.product_id() == pid)
                .map(|d| Found {
                    path: d.path().to_string_lossy().into_owned(),
                    product: d.product_string().map(str::to_string),
                })
                .collect())
        }

        fn open(&mut self, path: &str) -> Result<Box<dyn Device>, String> {
            let path = CString::new(path).map_err(|_| "a device path with a NUL in it".to_string())?;
            let dev = self.0.open_path(&path).map_err(|e| e.to_string())?;
            Ok(Box::new(Open(dev)))
        }
    }

    struct Open(hidapi::HidDevice);

    impl Device for Open {
        fn send_feature(&self, bytes: &[u8]) -> Result<(), String> {
            self.0.send_feature_report(bytes).map_err(|e| e.to_string())
        }

        fn get_feature(&self, id: u8, len: usize) -> Result<Vec<u8>, String> {
            let mut buf = vec![0u8; len];
            buf[0] = id;
            let n = self.0.get_feature_report(&mut buf).map_err(|e| e.to_string())?;
            // hidapi counts the id byte; a short answer keeps what came.
            buf.truncate(n.clamp(1, len));
            Ok(buf)
        }

        fn read(&self, ms: i32) -> Result<Option<Vec<u8>>, String> {
            let mut buf = [0u8; 64];
            match self.0.read_timeout(&mut buf, ms) {
                Ok(0) => Ok(None),
                Ok(n) => Ok(Some(buf[..n].to_vec())),
                Err(e) => Err(e.to_string()),
            }
        }

        fn write(&self, bytes: &[u8]) -> Result<(), String> {
            self.0.write(bytes).map(|_| ()).map_err(|e| e.to_string())
        }
    }
}
