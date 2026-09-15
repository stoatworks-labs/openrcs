//! Path builders for Midra 4K and Alta 4K.
//!
//! Midra 4K (QuickVu 4K, Pulse 4K, Eikos 4K, QuickMatrix 4K) and Alta 4K
//! (Zenith 100, Zenith 200) speak the same AWJ wire protocol as LivePremier —
//! the same port, framing, `get`/`replace`, silent writes and prefix
//! subscriptions — over a **different object model**. Not a variant spelling
//! of the same tree: every LivePremier path in [`crate::paths`] answers `E12`
//! on one of these, and every path here answers `E12` on an Aquilon. The
//! fleet's other tools call this model `mng`, after the name the device's own
//! web bundle carries, and so does this module.
//!
//! Everything here was read off a Pulse 4K on firmware 3.3.10 and checked
//! against the vendor's Midra 4K (3.2.29) and Alta 4K (1.3.7) simulators, whose
//! stores have the identical shape for every subtree named here. Six models
//! share one shape: four screens, four auxiliary screens, eight live layer
//! slots per screen, and banks of 200 / 200 / 50.
//!
//! What differs from LivePremier, and why a naive port sends each into nowhere:
//!
//! - **Destinations are numbered, in two lists.** Screen 1 and auxiliary 1 are
//!   both keyed `1`, in `$screen` and `$auxiliaryScreen`. There is no
//!   `S1`/`A1` on the wire, so the kind lives in [`Dest`] rather than in a key.
//! - **Takes live under a top-level `transition` node**, with one `takeTime`
//!   rather than a `takeUpTime`/`takeDownTime` pair.
//! - **The preset buffers are literally `UP` and `DOWN`**, not lettered, and
//!   which is program follows from the transition status alone — see
//!   [`crate::Buffer`]. Nothing has to be read to learn the letters.
//! - **Banks:** `preset/bank` for screens, `preset/auxBank` for auxiliaries (a
//!   bank of its own), `preset/masterBank`; slot metadata under `$slot`, not
//!   `$bank`. There is no layer bank.
//! - **"In use" is not on the destination.** It is in the *applied*
//!   preconfiguration — `preconfig/status/$state/@items/CURRENT` — as `enable`
//!   on a screen and a `mode` other than `DISABLE` on an auxiliary. The
//!   `preconfig/control` tree is what an operator has staged and may never
//!   apply.
//! - **Which memory a buffer holds is on the screen**, not in the bank:
//!   `$preset/@items/UP/status/@props/memoryId`, `0` when it was not loaded
//!   from a memory.
//! - **A layer is `$liveLayer/@items/1`…`8`**, its source is
//!   `source/@props/input` (`INPUT_<n>`, `NONE`, `COLOR` — no stills), and an
//!   auxiliary has no layers at all: its preset is one background source.

use alloc::format;
use alloc::string::String;

use crate::{Buffer, Preset};

/// A screen or an auxiliary screen. Both are numbered from 1 in their own
/// collections, so the kind has to travel with the number.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dest {
    /// A screen, `1`…`4`.
    Screen(u8),
    /// An auxiliary screen, `1`…`4`. No layers; one background source per
    /// preset buffer, and a bank of its own.
    Aux(u8),
}

impl Dest {
    /// Every destination the model can carry, whether or not it is set up.
    pub const ALL: [Dest; 8] = [
        Dest::Screen(1),
        Dest::Screen(2),
        Dest::Screen(3),
        Dest::Screen(4),
        Dest::Aux(1),
        Dest::Aux(2),
        Dest::Aux(3),
        Dest::Aux(4),
    ];

    /// The collection this destination lives in.
    pub fn list(self) -> &'static str {
        match self {
            Dest::Screen(_) => "$screen",
            Dest::Aux(_) => "$auxiliaryScreen",
        }
    }

    /// The item key: just the number.
    pub fn key(self) -> u8 {
        match self {
            Dest::Screen(n) | Dest::Aux(n) => n,
        }
    }

    /// `S1` or `A1` — the identifier a control surface uses. Never on the wire
    /// on this platform; kept so the same identifiers name a destination on
    /// every AWJ device.
    pub fn id(self) -> String {
        match self {
            Dest::Screen(n) => format!("S{n}"),
            Dest::Aux(n) => format!("A{n}"),
        }
    }

    /// Parse `S1`/`A1`.
    pub fn parse(id: &str) -> Option<Dest> {
        if let Some(n) = id.strip_prefix('S') {
            return n.parse().ok().map(Dest::Screen);
        }
        id.strip_prefix('A')
            .and_then(|n| n.parse().ok())
            .map(Dest::Aux)
    }

    /// The bank a preset recall or save on this destination goes to.
    pub fn bank(self) -> Bank {
        match self {
            Dest::Screen(_) => Bank::Screen,
            Dest::Aux(_) => Bank::Aux,
        }
    }

    fn item(self) -> String {
        format!("{}/@items/{}", self.list(), self.key())
    }
}

/// The three memory banks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Bank {
    /// Screen presets, 200 slots.
    Screen,
    /// Auxiliary presets, 200 slots — a bank of its own, where LivePremier
    /// folds auxiliaries into the screen bank.
    Aux,
    /// Master presets, 50 slots.
    Master,
}

impl Bank {
    /// Slot numbers run `1`…`slots()`; one past answers `E12`.
    pub fn slots(self) -> u16 {
        match self {
            Bank::Screen | Bank::Aux => 200,
            Bank::Master => 50,
        }
    }

    fn root(self) -> &'static str {
        match self {
            Bank::Screen => "preset/bank",
            Bank::Aux => "preset/auxBank",
            Bank::Master => "preset/masterBank",
        }
    }
}

fn preset_key(p: Preset) -> &'static str {
    match p {
        Preset::Program => "PROGRAM",
        Preset::Preview => "PREVIEW",
    }
}

/// The applied preconfiguration: what the device is running.
const CURRENT: &str = "DeviceObject/preconfig/status/$state/@items/CURRENT";

// ---------------------------------------------------------------- system

/// Device model: `QVU`, `PULSE`, `EIKOS`, `QMX`, `ZEN100` or `ZEN200`.
///
/// Note the spelling — there is no `$device` collection on this platform, so
/// this is also the cheapest way to tell the two AWJ object models apart: it
/// answers here and is `E12` on a LivePremier, and the reverse holds for
/// [`crate::paths::device_model`].
pub fn device_model() -> String {
    String::from("DeviceObject/system/@props/dev")
}

/// The product line, as the device names it: `Midra 4K` or `Alta 4K`.
pub fn platform_label() -> String {
    String::from("DeviceObject/system/@props/platformLabel")
}

/// Firmware version, e.g. `3.3.10`.
pub fn device_version() -> String {
    String::from("DeviceObject/system/version/@props/updater")
}

/// Device serial number.
pub fn device_serial() -> String {
    String::from("DeviceObject/system/serial/@props/serialNumber")
}

/// The operator's name for the unit.
pub fn device_label() -> String {
    String::from("DeviceObject/system/@props/label")
}

// ---------------------------------------------------------------- destinations

/// Destination label. Empty when the operator has not named it.
pub fn label(d: Dest) -> String {
    format!("DeviceObject/{}/control/@props/label", d.item())
}

/// Whether a screen is in service — `enable` in the *applied* configuration.
///
/// Every screen exists in the model whether or not it has outputs, so path
/// validity proves nothing; this does. A screen that reads `false` here still
/// answers every other path, with a 0×0 canvas.
pub fn screen_enabled(screen: u8) -> String {
    format!("{CURRENT}/$screen/@items/{screen}/@props/enable")
}

/// How an auxiliary is set up in the applied configuration. `DISABLE` means
/// not in service; anything else is a mode it is running in.
pub fn aux_mode(aux: u8) -> String {
    format!("{CURRENT}/$auxiliaryScreen/@items/{aux}/@props/mode")
}

/// How many live layers the applied configuration has given a screen.
pub fn screen_layer_count(screen: u8) -> String {
    format!("{CURRENT}/$screen/@items/{screen}/@props/layerCount")
}

/// Whether a layer slot is fitted: a mode other than `DISABLE`. Every screen
/// carries slots `1`…`8` regardless, and a preset holds geometry for all of
/// them, so this is the only thing that says which are real.
pub fn layer_mode(screen: u8, layer: u8) -> String {
    format!("{CURRENT}/$screen/@items/{screen}/$liveLayer/@items/{layer}/@props/mode")
}

/// Where the destination's T-bar is — parse with [`crate::Transition::parse`].
/// The same six states as LivePremier, and the same suffix rule; here the
/// suffix also names the buffer, see [`crate::Buffer::program`].
pub fn transition(d: Dest) -> String {
    format!("DeviceObject/transition/{}/status/@props/transition", d.item())
}

/// T-bar position, `0`…`65535`.
///
/// There is no `status/take` (`OFF`/`TO_UP`/`TO_DOWN`) on this platform; the
/// four in-flight [`crate::Transition`] states are the only sign of a fade in
/// progress.
pub fn tbar_position(d: Dest) -> String {
    format!("DeviceObject/transition/{}/status/@props/tbarPosition", d.item())
}

/// Transition duration in tenths of a second. One time serves both
/// directions, where LivePremier has a pair.
///
/// A preset recall overwrites this with the duration stored in the memory,
/// as on LivePremier: load, then set the fade, then transition.
pub fn take_time(d: Dest) -> String {
    format!("DeviceObject/transition/{}/control/@props/takeTime", d.item())
}

/// Fire a TAKE. Write `true`; the device answers nothing. A trigger, not a
/// flag — see [`crate::paths::screen_take`].
pub fn take(d: Dest) -> String {
    format!("DeviceObject/transition/{}/control/@props/xTake", d.item())
}

/// Cut: take with no transition.
pub fn cut(d: Dest) -> String {
    format!("DeviceObject/transition/{}/control/@props/xCut", d.item())
}

/// Return to the previous program.
pub fn step_back(d: Dest) -> String {
    format!("DeviceObject/transition/{}/control/@props/xStepBack", d.item())
}

/// Abort a transition in flight.
pub fn take_abort(d: Dest) -> String {
    format!("DeviceObject/transition/{}/control/@props/xTakeAbort", d.item())
}

/// Copy program to preview.
pub fn copy_program_to_preview(d: Dest) -> String {
    format!(
        "DeviceObject/transition/{}/control/@props/xCopyProgramToPreview",
        d.item()
    )
}

/// Which memory slot a buffer holds: `0` when it was not loaded from one.
pub fn buffer_memory_id(d: Dest, buffer: Buffer) -> String {
    format!(
        "DeviceObject/{}/$preset/@items/{}/status/@props/memoryId",
        d.item(),
        buffer.key()
    )
}

/// Whether a buffer has been edited since its memory was loaded. The
/// inverse sense of LivePremier's `isNotModified`.
pub fn buffer_is_modified(d: Dest, buffer: Buffer) -> String {
    format!(
        "DeviceObject/{}/$preset/@items/{}/status/@props/isModified",
        d.item(),
        buffer.key()
    )
}

// ---------------------------------------------------------------- presets

/// Whether a bank slot holds anything. `$slot`, not `$bank` — the LivePremier
/// spelling answers `E12` here.
pub fn preset_is_valid(bank: Bank, slot: u16) -> String {
    format!(
        "DeviceObject/{}/$slot/@items/{slot}/status/@props/isValid",
        bank.root()
    )
}

/// The operator's name for a bank slot.
pub fn preset_label(bank: Bank, slot: u16) -> String {
    format!(
        "DeviceObject/{}/$slot/@items/{slot}/control/@props/label",
        bank.root()
    )
}

/// Erase a bank slot. A trigger.
pub fn preset_delete(bank: Bank, slot: u16) -> String {
    format!(
        "DeviceObject/{}/$slot/@items/{slot}/control/@props/xDelete",
        bank.root()
    )
}

/// Recall a screen or auxiliary preset onto `target`. The bank is implied
/// by the destination — a screen recalls from `preset/bank`, an auxiliary
/// from `preset/auxBank` — because the cross combinations do not exist.
///
/// Slot first, destination second, target last; the save nests the other
/// way round, as on LivePremier.
pub fn load_preset(slot: u16, d: Dest, target: Preset) -> String {
    format!(
        "DeviceObject/{}/control/load/$slot/@items/{slot}/{}/$preset/@items/{}/@props/xRequest",
        d.bank().root(),
        d.item(),
        preset_key(target)
    )
}

/// Save a destination's `from` buffer into a bank slot.
pub fn save_preset(slot: u16, d: Dest, from: Preset) -> String {
    format!(
        "DeviceObject/{}/control/save/{}/$preset/@items/{}/$slot/@items/{slot}/@props/xRequest",
        d.bank().root(),
        d.item(),
        preset_key(from)
    )
}

/// Recall a master preset onto `target`.
pub fn load_master_preset(slot: u16, target: Preset) -> String {
    format!(
        "DeviceObject/preset/masterBank/control/load/$slot/@items/{slot}/$preset/@items/{}/@props/xRequest",
        preset_key(target)
    )
}

/// Save a master preset. What it records is set beforehand on
/// `preset/masterBank/control/save/@props/*` — `mode` is one of
/// `SAVE_FROM_PGM`, `SAVE_FROM_PRW` (note the spelling: `PRW`, not `PVW`;
/// the device refuses the wrong word silently and keeps the old mode) and
/// `USE_EXISTING_MEMORIES`.
pub fn save_master_preset(slot: u16) -> String {
    format!("DeviceObject/preset/masterBank/control/save/$slot/@items/{slot}/@props/xRequest")
}

// ---------------------------------------------------------------- layers

/// The source on a screen's live layer, `1`…`8`: `INPUT_<n>`, `NONE` or
/// `COLOR`. Addressed by buffer, so [`crate::Buffer::for_preset`] first.
pub fn layer_source(screen: u8, buffer: Buffer, layer: u8) -> String {
    format!(
        "DeviceObject/$screen/@items/{screen}/$preset/@items/{}/$liveLayer/@items/{layer}/source/@props/input",
        buffer.key()
    )
}

/// The background source of an auxiliary's buffer — its whole picture, since
/// an auxiliary has no layers.
pub fn aux_source(aux: u8, buffer: Buffer) -> String {
    format!(
        "DeviceObject/$auxiliaryScreen/@items/{aux}/$preset/@items/{}/background/source/@props/content",
        buffer.key()
    )
}

/// A subscription prefix that covers every destination's transition control
/// and status — both lists, since the pushes are filtered by prefix.
pub const SUB_TRANSITIONS: &str = "DeviceObject/transition";
