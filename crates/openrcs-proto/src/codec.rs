//! Encoding and decoding of the on-wire command format.

use alloc::string::String;
use alloc::vec::Vec;
use core::fmt::Write;

use crate::{Error, Platform};

/// Encode a set: `idx0,idx1,…,<value><MNEMONIC><terminator>`.
///
/// Indices are each followed by a comma; the value is appended bare, then the
/// mnemonic, then the platform terminator.
pub fn encode_set(p: Platform, mnemonic: &str, indices: &[u32], value: i64) -> String {
    let mut s = String::new();
    for i in indices {
        let _ = write!(s, "{i},");
    }
    let _ = write!(s, "{value}{mnemonic}{}", p.terminator());
    s
}

/// Encode a request: `idx0,idx1,…,<MNEMONIC><terminator>`.
///
/// Note the trailing comma after the last index — the protocol emits one comma
/// per index regardless of what follows.
pub fn encode_get(p: Platform, mnemonic: &str, indices: &[u32]) -> String {
    let mut s = String::new();
    for i in indices {
        let _ = write!(s, "{i},");
    }
    let _ = write!(s, "{mnemonic}{}", p.terminator());
    s
}

/// One decoded reply from the device.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reply {
    /// Mnemonic as sent by the device (match against [`crate::VarDef::answer`]).
    pub mnemonic: String,
    /// Index tuple, outermost first.
    pub indices: Vec<i64>,
    /// The value — always the last comma-separated field.
    pub value: i64,
}

/// One line from the device — either a value update or an error.
///
/// Value updates look like `INpcr5,200`; errors look like `E10`. Both are
/// CRLF-terminated even on LiveCore, which sends bare LF the other direction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Frame {
    /// A value update or status push.
    Value(Reply),
    /// A device error / NAK, `E<code>`. Known codes:
    /// `10` = unknown command, `12` = wrong number of indices.
    Error(u16),
}

/// Streaming reply decoder.
///
/// Replies are separated by `\n`. The device may split them across reads, so
/// a trailing partial line is buffered until the rest arrives — the vendor
/// client does exactly this and so must we.
#[derive(Debug, Default, Clone)]
pub struct Decoder {
    buf: String,
}

impl Decoder {
    pub fn new() -> Self {
        Self { buf: String::new() }
    }

    /// Feed raw bytes, returning every frame that completed.
    ///
    /// Invalid UTF-8 is dropped rather than erroring: this is a control link,
    /// and a garbled byte should not kill the session. Unparseable lines are
    /// skipped for the same reason.
    pub fn feed(&mut self, bytes: &[u8]) -> Vec<Frame> {
        self.feed_str(&String::from_utf8_lossy(bytes))
    }

    /// As [`Decoder::feed`], for input already known to be text.
    pub fn feed_str(&mut self, text: &str) -> Vec<Frame> {
        self.buf.push_str(text);
        let mut out = Vec::new();
        while let Some(nl) = self.buf.find('\n') {
            let line: String = self.buf[..nl].into();
            self.buf.drain(..=nl);
            if let Ok(f) = parse_frame(line.trim_end_matches('\r')) {
                out.push(f);
            }
        }
        out
    }

    /// Bytes held back awaiting the rest of a line.
    pub fn pending(&self) -> &str {
        &self.buf
    }
}

/// Parse one line from the device into a [`Frame`].
///
/// An `E<code>` line (no comma, `E` then digits) is a device error; anything
/// else is parsed as a value reply.
pub fn parse_frame(line: &str) -> Result<Frame, Error> {
    if let Some(code) = line.strip_prefix('E') {
        if !code.is_empty() && code.bytes().all(|b| b.is_ascii_digit()) {
            return Ok(Frame::Error(code.parse().map_err(|_| Error::MalformedReply)?));
        }
    }
    parse_reply(line).map(Frame::Value)
}

/// Parse a single reply line: `<MNEMONIC>idx0,idx1,…,<value>`.
///
/// Scans past the leading alphabetic mnemonic and splits at the first digit,
/// comma, or `-`. Breaking on `-` lets a negative value on a variable with no
/// indices decode correctly.
pub fn parse_reply(line: &str) -> Result<Reply, Error> {
    let split = line
        .char_indices()
        .find(|(_, c)| c.is_ascii_digit() || *c == ',' || *c == '-')
        .map(|(i, _)| i)
        .ok_or(Error::MalformedReply)?;

    let (mnemonic, tail) = line.split_at(split);
    if mnemonic.is_empty() || tail.is_empty() {
        return Err(Error::MalformedReply);
    }

    let mut nums = Vec::new();
    for field in tail.split(',') {
        nums.push(field.trim().parse::<i64>().map_err(|_| Error::MalformedReply)?);
    }

    let value = nums.pop().ok_or(Error::MalformedReply)?;
    Ok(Reply {
        mnemonic: mnemonic.into(),
        indices: nums,
        value,
    })
}

/// Encode a set, first checking the variable exists and the arguments fit.
pub fn encode_set_checked(
    p: Platform,
    mnemonic: &str,
    indices: &[u32],
    value: i64,
) -> Result<String, Error> {
    let v = p.lookup(mnemonic).ok_or(Error::UnknownMnemonic)?;
    v.validate(indices, value)?;
    Ok(encode_set(p, mnemonic, indices, value))
}

/// Encode a request, first checking the variable exists and the indices fit.
pub fn encode_get_checked(
    p: Platform,
    mnemonic: &str,
    indices: &[u32],
) -> Result<String, Error> {
    let v = p.lookup(mnemonic).ok_or(Error::UnknownMnemonic)?;
    v.validate_indices(indices)?;
    Ok(encode_get(p, mnemonic, indices))
}
