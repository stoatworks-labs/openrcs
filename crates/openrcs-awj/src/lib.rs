//! Wire protocol for Analog Way LivePremier series video processors (AWJ).
//!
//! A different generation from the Midra/LiveCore mnemonics in `openrcs-proto`
//! and it shares nothing with them but a company name. AWJ is JSON over TCP
//! **10606**: the device is one large JSON state object, and writing a property
//! *is* the command.
//!
//! ```text
//! get:      {"op":"get","path":"<path>"}\x04
//! replace:  {"op":"replace","path":"<path>","value":<json>}\x04
//! reply:    {"path":"<path>","value":<json>}\x04
//! error:    {"error":{"code":"E12","message":"…"}}\x04
//! ```
//!
//! Three properties of the protocol shape everything above it:
//!
//! - **Messages are terminated by ASCII `0x04`**, not a newline, and a value
//!   may legitimately contain newlines. [`Decoder`] splits on `0x04` only.
//! - **Writes are silent.** A `replace` returns nothing at all, so the outcome
//!   of a command can only be learned by reading it back or by subscribing.
//! - **Subscriptions start empty.** A connected client is told nothing about
//!   state changes until it writes a subscription list ([`paths::SUBSCRIPTIONS`]).
//!
//! The device accepts at most **5 concurrent TCP clients**, and the port can be
//! disabled in the device's own security settings.
//!
//! Paths here follow the firmware v4.0-and-later layout, in which screens and
//! auxiliaries are separate collections. Path layouts have moved between
//! firmware generations before, so treat every path as firmware-tagged: see
//! [`paths`].

#![cfg_attr(not(feature = "std"), no_std)]
#![forbid(unsafe_code)]

extern crate alloc;

mod codec;
pub mod paths;

pub use codec::{encode_get, encode_replace, Decoder, Frame};
pub use serde_json::Value;

use alloc::string::String;

/// TCP port the AWJ interpreter listens on.
pub const PORT: u16 = 10606;

/// Message terminator. Not a newline — a string value may contain those.
pub const EOT: char = '\u{4}';

/// Maximum concurrent TCP clients the device accepts.
pub const MAX_CLIENTS: u8 = 5;

/// A device error reply.
///
/// The device NAKs a command it cannot process and then carries on; an error
/// is not a reason to drop the link.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceError {
    pub code: ErrorCode,
    pub message: String,
}

/// Error codes named in the AWJ Programmer's Guide.
///
/// [`ErrorCode::UnexpectedPath`] doubles as a path-existence oracle: an
/// unknown path answers E12 rather than an empty value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ErrorCode {
    /// E09 — unexpected command JSON token.
    BadToken,
    /// E10 — unexpected keyword; only `op`, `path` and `value` are accepted.
    BadKeyword,
    /// E11 — unexpected operator; only `get` and `replace` exist.
    BadOperator,
    /// E12 — unexpected path.
    UnexpectedPath,
    /// E13 — unexpected value.
    BadValue,
    /// A code this crate does not know. Kept verbatim rather than collapsed,
    /// so a firmware that grows a code stays diagnosable.
    Other(String),
}

impl ErrorCode {
    pub fn parse(code: &str) -> Self {
        match code {
            "E09" => ErrorCode::BadToken,
            "E10" => ErrorCode::BadKeyword,
            "E11" => ErrorCode::BadOperator,
            "E12" => ErrorCode::UnexpectedPath,
            "E13" => ErrorCode::BadValue,
            other => ErrorCode::Other(String::from(other)),
        }
    }

    pub fn as_str(&self) -> &str {
        match self {
            ErrorCode::BadToken => "E09",
            ErrorCode::BadKeyword => "E10",
            ErrorCode::BadOperator => "E11",
            ErrorCode::UnexpectedPath => "E12",
            ErrorCode::BadValue => "E13",
            ErrorCode::Other(s) => s,
        }
    }
}

/// Where a screen's virtual T-bar is, or which end it is travelling from.
///
/// Reported at `…/$screenAuxGroup/@items/S<n>/status/@props/transition`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Transition {
    AtDown,
    AtUp,
    EffectFromDown,
    EffectFromUp,
    CopyFromDown,
    CopyFromUp,
}

impl Transition {
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "AT_DOWN" => Transition::AtDown,
            "AT_UP" => Transition::AtUp,
            "EFFECT_FROM_DOWN" => Transition::EffectFromDown,
            "EFFECT_FROM_UP" => Transition::EffectFromUp,
            "COPY_FROM_DOWN" => Transition::CopyFromDown,
            "COPY_FROM_UP" => Transition::CopyFromUp,
            _ => return None,
        })
    }

    /// True when the *down* preset is the one on air.
    ///
    /// Every variant names the end the T-bar is at or came from, so the whole
    /// rule is the DOWN/UP suffix. Testing only for `AT_UP` gets all four
    /// in-flight states backwards — and does so invisibly, for exactly the
    /// length of a transition, which is how a preview control becomes a live
    /// one. Pinned in `tests/conformance.rs`.
    pub fn program_is_down(self) -> bool {
        matches!(
            self,
            Transition::AtDown | Transition::EffectFromDown | Transition::CopyFromDown
        )
    }
}

/// Which of a screen's two live parameter sets a command addresses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Preset {
    Program,
    Preview,
}

/// The preset *letters* a screen currently has at each end of its T-bar.
///
/// A layer's address contains a letter, not the word "preview" — a screen holds
/// three preset memories (`A`, `B`, `C`) and which one is on air changes as the
/// device is used. The Programmer's Guide §3.8 documents the two-letter case
/// (down = `A`, up = `B`), available here as [`Letters::DOCUMENTED`], but a
/// device reports its own at
/// `…/$screenAuxGroup/@items/S<n>/control/@props/{presetDown,presetUp}` and a
/// third letter does appear in the wild. Read them rather than assume them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Letters {
    pub down: char,
    pub up: char,
}

impl Letters {
    /// The mapping printed in the Programmer's Guide §3.8.
    pub const DOCUMENTED: Letters = Letters { down: 'A', up: 'B' };

    /// The letter addressing `preset` given where the T-bar is.
    pub fn letter(self, transition: Transition, preset: Preset) -> char {
        let program_is_down = transition.program_is_down();
        let want_down = match preset {
            Preset::Program => program_is_down,
            Preset::Preview => !program_is_down,
        };
        if want_down {
            self.down
        } else {
            self.up
        }
    }
}
