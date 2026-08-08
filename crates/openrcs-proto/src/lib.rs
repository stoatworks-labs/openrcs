//! Wire protocol for Analog Way Midra and LiveCore series video processors.
//!
//! Both generations speak a terse ASCII protocol over TCP 10500. The encoding
//! is asymmetric — commands put the mnemonic last, replies put it first:
//!
//! ```text
//! set:    idx0,idx1,…,<value><MNEMONIC><terminator>
//! get:    idx0,idx1,…,<MNEMONIC><terminator>
//! reply:  <MNEMONIC>idx0,idx1,…,<value>\n
//! ```
//!
//! The terminator differs by platform: Midra sends CRLF, LiveCore sends LF,
//! and the almost-least-weasel custom profile sends CRLF. See [`Platform`].
//!
//! Per-variable ranges and dimensions are declarations, not guarantees — the
//! crate validates against them but the device is the final authority.
//!
//! The crate is `no_std` + `alloc`, so the same engine runs on a desktop tray
//! app, a Pi gateway, or an embedded target.

#![cfg_attr(not(feature = "std"), no_std)]
#![forbid(unsafe_code)]

extern crate alloc;

mod codec;
mod tables;

pub use codec::{
    encode_get, encode_get_checked, encode_set, encode_set_checked, parse_frame,
    parse_reply, Decoder, Frame, Reply,
};
pub use tables::{almost_least_weasel, livecore, midra};

/// One controllable variable in the device's control table.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VarDef {
    /// Mnemonic sent to the device (usually 5 chars; a few specials are 1).
    pub mnemonic: &'static str,
    /// Mnemonic the device replies with. Differs from `mnemonic` only for the
    /// handful of debug/identify specials.
    pub answer: &'static str,
    /// Vendor's symbolic name, e.g. `TBAR`.
    pub name: &'static str,
    /// Vendor's grouping, e.g. `GRP_TAKE_CONTROL`.
    pub group: &'static str,
    /// Size of each index axis, outermost first. Empty means no indices.
    pub dims: &'static [u32],
    pub min: i64,
    pub max: i64,
    pub default: i64,
    /// Device-to-client status only; setting it is meaningless.
    pub read_only: bool,
}

impl VarDef {
    /// Number of indices this variable expects.
    pub fn rank(&self) -> usize {
        self.dims.len()
    }

    /// Check indices and value against the declared shape and range.
    pub fn validate(&self, indices: &[u32], value: i64) -> Result<(), Error> {
        self.validate_indices(indices)?;
        if self.read_only {
            return Err(Error::ReadOnly(self.mnemonic));
        }
        if value < self.min || value > self.max {
            return Err(Error::ValueOutOfRange {
                mnemonic: self.mnemonic,
                value,
                min: self.min,
                max: self.max,
            });
        }
        Ok(())
    }

    /// Check indices alone — valid for reads as well as writes.
    pub fn validate_indices(&self, indices: &[u32]) -> Result<(), Error> {
        if indices.len() != self.dims.len() {
            return Err(Error::WrongRank {
                mnemonic: self.mnemonic,
                expected: self.dims.len(),
                got: indices.len(),
            });
        }
        for (axis, (&i, &d)) in indices.iter().zip(self.dims).enumerate() {
            if i >= d {
                return Err(Error::IndexOutOfRange {
                    mnemonic: self.mnemonic,
                    axis,
                    index: i,
                    bound: d,
                });
            }
        }
        Ok(())
    }
}

/// Which device family a connection is talking to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    /// Pulse2, Eikos2, Saphyr, SmartMatriX2, QuickMatriX, QuickVu.
    Midra,
    /// Ascender 16/32/48, NeXtage 8/16, SmartMatriX Ultra.
    LiveCore,
    /// almost-least-weasel (ALW1): a custom switcher speaking the
    /// LiveCore-family wire format with its own identity and dimensions.
    AlmostLeastWeasel,
}

impl Platform {
    /// Terminator appended to outbound commands.
    pub fn terminator(self) -> &'static str {
        match self {
            Platform::Midra => midra::TERMINATOR,
            Platform::LiveCore => livecore::TERMINATOR,
            Platform::AlmostLeastWeasel => almost_least_weasel::TERMINATOR,
        }
    }

    /// Default control port (10500 on both, but keep it addressable).
    pub fn port(self) -> u16 {
        match self {
            Platform::Midra => midra::PORT,
            Platform::LiveCore => livecore::PORT,
            Platform::AlmostLeastWeasel => almost_least_weasel::PORT,
        }
    }

    /// This platform's variable table, sorted by mnemonic.
    pub fn vars(self) -> &'static [VarDef] {
        match self {
            Platform::Midra => midra::VARS,
            Platform::LiveCore => livecore::VARS,
            Platform::AlmostLeastWeasel => almost_least_weasel::VARS,
        }
    }

    /// Look a variable up by the mnemonic sent to the device.
    pub fn lookup(self, mnemonic: &str) -> Option<&'static VarDef> {
        let t = self.vars();
        t.binary_search_by(|v| v.mnemonic.cmp(mnemonic))
            .ok()
            .map(|i| &t[i])
    }

    /// Look a variable up by the mnemonic the device replies with.
    ///
    /// Linear, because `answer` is not the sort key — but it differs from
    /// `mnemonic` for only a few specials, so try the fast path first.
    pub fn lookup_answer(self, mnemonic: &str) -> Option<&'static VarDef> {
        if let Some(v) = self.lookup(mnemonic) {
            if v.answer == mnemonic {
                return Some(v);
            }
        }
        self.vars().iter().find(|v| v.answer == mnemonic)
    }

    /// Look a variable up by the vendor's symbolic name, e.g. `"TBAR"`.
    pub fn lookup_name(self, name: &str) -> Option<&'static VarDef> {
        self.vars().iter().find(|v| v.name == name)
    }
}

/// Everything that can go wrong encoding or decoding.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    /// No variable with that mnemonic in this platform's table.
    UnknownMnemonic,
    /// Wrong number of indices for the variable's declared shape.
    WrongRank {
        mnemonic: &'static str,
        expected: usize,
        got: usize,
    },
    /// An index exceeded its axis bound.
    IndexOutOfRange {
        mnemonic: &'static str,
        axis: usize,
        index: u32,
        bound: u32,
    },
    /// Value outside the variable's declared min..=max.
    ValueOutOfRange {
        mnemonic: &'static str,
        value: i64,
        min: i64,
        max: i64,
    },
    /// Tried to set a status-only variable.
    ReadOnly(&'static str),
    /// A reply line had no numeric tail, so carried no value.
    MalformedReply,
}

impl core::fmt::Display for Error {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Error::UnknownMnemonic => write!(f, "unknown mnemonic"),
            Error::WrongRank { mnemonic, expected, got } => write!(
                f, "{mnemonic} expects {expected} indices, got {got}"),
            Error::IndexOutOfRange { mnemonic, axis, index, bound } => write!(
                f, "{mnemonic} index {index} on axis {axis} exceeds {bound}"),
            Error::ValueOutOfRange { mnemonic, value, min, max } => write!(
                f, "{mnemonic} value {value} outside {min}..={max}"),
            Error::ReadOnly(m) => write!(f, "{m} is read-only"),
            Error::MalformedReply => write!(f, "reply carried no value"),
        }
    }
}

#[cfg(feature = "std")]
impl std::error::Error for Error {}
