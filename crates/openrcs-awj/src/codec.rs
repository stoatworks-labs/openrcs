//! Encoding and decoding of the on-wire message format.

use alloc::string::{String, ToString};
use alloc::vec::Vec;

use serde_json::Value;

use crate::{DeviceError, ErrorCode, EOT};

/// Encode a read: `{"op":"get","path":"<path>"}\x04`.
///
/// The path is serialised through `serde_json` rather than pasted in, so a
/// path containing a quote or a backslash escapes correctly instead of
/// producing a message the device answers with E09.
pub fn encode_get(path: &str) -> String {
    let mut s = String::from("{\"op\":\"get\",\"path\":");
    s.push_str(&Value::String(path.to_string()).to_string());
    s.push('}');
    s.push(EOT);
    s
}

/// Encode a write: `{"op":"replace","path":"<path>","value":<json>}\x04`.
///
/// The device answers a write with nothing whatsoever — not an ack, not an
/// echo. Confirm a write by reading the property back, or by subscribing to it
/// first.
pub fn encode_replace(path: &str, value: &Value) -> String {
    let mut s = String::from("{\"op\":\"replace\",\"path\":");
    s.push_str(&Value::String(path.to_string()).to_string());
    s.push_str(",\"value\":");
    s.push_str(&value.to_string());
    s.push('}');
    s.push(EOT);
    s
}

/// One decoded message from the device.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Frame {
    /// A value reply, or a subscribed property that changed.
    Value { path: String, value: Value },
    /// A NAK. The link stays up; the device simply refused this one message.
    Error(DeviceError),
}

/// Streaming message decoder.
///
/// Messages are separated by `0x04` and nothing else. The device splits them
/// across reads freely — a large value arrives in pieces — so a trailing
/// partial message is buffered until its terminator turns up.
#[derive(Debug, Default, Clone)]
pub struct Decoder {
    buf: String,
}

impl Decoder {
    pub fn new() -> Self {
        Self { buf: String::new() }
    }

    /// Feed raw bytes, returning every message that completed.
    ///
    /// Invalid UTF-8 is replaced rather than erroring, and an unparseable
    /// message is skipped: this is a control link, and one bad message should
    /// not cost the session.
    pub fn feed(&mut self, bytes: &[u8]) -> Vec<Frame> {
        self.feed_str(&String::from_utf8_lossy(bytes))
    }

    /// As [`Decoder::feed`], for input already known to be text.
    pub fn feed_str(&mut self, text: &str) -> Vec<Frame> {
        self.buf.push_str(text);
        let mut out = Vec::new();
        while let Some(end) = self.buf.find(EOT) {
            let msg: String = self.buf[..end].into();
            self.buf.drain(..=end);
            if let Some(f) = parse_frame(msg.trim()) {
                out.push(f);
            }
        }
        out
    }

    /// Text held back awaiting a terminator.
    pub fn pending(&self) -> &str {
        &self.buf
    }
}

/// Parse one complete message (terminator already stripped).
///
/// Returns `None` for anything that is not JSON, or is JSON but carries
/// neither a `path`/`value` pair nor an `error` — a shape this crate has no
/// meaning for is dropped rather than guessed at.
pub fn parse_frame(msg: &str) -> Option<Frame> {
    let v: Value = serde_json::from_str(msg).ok()?;

    if let Some(err) = v.get("error") {
        let code = err.get("code").and_then(Value::as_str).unwrap_or_default();
        let message = err.get("message").and_then(Value::as_str).unwrap_or_default();
        return Some(Frame::Error(DeviceError {
            code: ErrorCode::parse(code),
            message: message.to_string(),
        }));
    }

    let path = v.get("path")?.as_str()?.to_string();
    // A reply always carries `value`; null is a legitimate value, so the key's
    // presence is what matters, not its contents.
    let value = v.get("value")?.clone();
    Some(Frame::Value { path, value })
}
