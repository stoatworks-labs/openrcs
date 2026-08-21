//! Path builders for the documented command set.
//!
//! Paths are the whole API surface of AWJ, and they are **firmware-tagged**:
//! the layout changed at v4.0 (a device selector appeared for the Link feature,
//! and screens and auxiliaries split into separate collections) and individual
//! properties have moved since. Everything here follows the v6.2 Programmer's
//! Guide. Where a device is known to disagree with the guide it is called out
//! on the function.
//!
//! Two notes that save a lot of confusion:
//!
//! - **A container cannot be enumerated.** A `get` on a collection or on an
//!   `@props` bag returns `{}`, not its contents, so there is no walking the
//!   tree — only leaves read. An unknown path answers `E12`, which makes a
//!   cheap existence oracle but says nothing about whether a screen is *in
//!   use*; [`screen_is_used`] answers that.
//! - **Layer parameters are addressed by preset letter**, not by "preview".
//!   See [`crate::Letters`].

use alloc::format;
use alloc::string::String;

use crate::Preset;

/// The subscription filter list. Read it, or write an array of path prefixes
/// to it; a change is pushed only when its path starts with one of them.
///
/// A client that never writes this receives nothing but its own replies.
pub const SUBSCRIPTIONS: &str = "Subscriptions";

fn preset_key(p: Preset) -> &'static str {
    match p {
        Preset::Program => "PROGRAM",
        Preset::Preview => "PREVIEW",
    }
}

/// One layer of a screen or auxiliary. Keys are `NATIVE`, then `1`…`128`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Layer {
    /// The screen's own background layer, which occupies a layer slot and is
    /// counted against capacity like any other.
    Native,
    /// A numbered live layer.
    N(u16),
}

impl Layer {
    fn key(self) -> String {
        match self {
            Layer::Native => String::from("NATIVE"),
            Layer::N(n) => format!("{n}"),
        }
    }
}

// ---------------------------------------------------------------- system

/// Device model, e.g. `NLC_C` or `NLC_RS4`. `device` is 1 on a lone frame, and
/// 1–4 across a Link set.
pub fn device_model(device: u8) -> String {
    format!("DeviceObject/system/$device/@items/{device}/@props/dev")
}

/// Device serial number.
///
/// Documented, but **answered `E12` by an Aquilon C on firmware 6.2.73** —
/// firmware builds differ in which of these they carry. Treat an error here as
/// "this build does not have it", not as a broken link.
pub fn device_serial(device: u8) -> String {
    format!("DeviceObject/system/$device/@items/{device}/serial/@props/serialNumber")
}

/// Firmware version. Carries the same 6.2 caveat as [`device_serial`].
pub fn device_version(device: u8) -> String {
    format!("DeviceObject/system/$device/@items/{device}/version/@props/updater")
}

// ---------------------------------------------------------------- screens

/// Screen label, `S1`…`S24`. Empty when the operator has not named it.
pub fn screen_label(screen: u8) -> String {
    format!("DeviceObject/$screen/@items/S{screen}/control/@props/label")
}

/// Auxiliary label, `A1`…`A32`.
pub fn aux_label(aux: u8) -> String {
    format!("DeviceObject/$auxiliary/@items/A{aux}/control/@props/label")
}

/// Screen activation in the staged configuration: `DISABLED` or `FREESTYLE`.
pub fn screen_mode(screen: u8) -> String {
    format!("DeviceObject/preconfig/resources/new/$screen/@items/S{screen}/control/@props/mode")
}

/// Whether a screen is configured and in use.
///
/// The one reliable way to inventory a show: every `S1`…`S24` address exists in
/// the model whether or not it is set up, so path validity proves nothing.
pub fn screen_is_used(screen: u8) -> String {
    format!("DeviceObject/$screenAuxGroup/@items/S{screen}/status/@props/isUsed")
}

/// Where the screen's T-bar is — parse with [`crate::Transition::parse`].
pub fn screen_transition(screen: u8) -> String {
    format!("DeviceObject/$screenAuxGroup/@items/S{screen}/status/@props/transition")
}

/// Transition activity: `OFF`, `TO_UP`, `TO_DOWN`.
///
/// Returning to `OFF` is the signal that a take has *finished*. The T-bar
/// position property does not animate — it reports only its end value — so it
/// cannot be used as progress.
pub fn screen_take_status(screen: u8) -> String {
    format!("DeviceObject/$screenAuxGroup/@items/S{screen}/status/@props/take")
}

/// The letter currently at the down end of the T-bar (`presetDown`), the up end
/// (`presetUp`), or the one before that (`presetPrevious`).
pub fn screen_preset_letter(screen: u8, which: &str) -> String {
    format!("DeviceObject/$screenAuxGroup/@items/S{screen}/control/@props/preset{which}")
}

/// Fire a TAKE on one screen. Write `true`; the device answers nothing.
pub fn screen_take(screen: u8) -> String {
    format!("DeviceObject/$screenAuxGroup/@items/S{screen}/control/@props/xTake")
}

/// Cut, i.e. take with no transition.
pub fn screen_cut(screen: u8) -> String {
    format!("DeviceObject/$screenAuxGroup/@items/S{screen}/control/@props/xCut")
}

/// Transition duration in tenths of a second, 0–3000.
///
/// `up` is the direction that brings the new picture in. **A preset recall
/// overwrites `takeUpTime`** with the duration stored inside the preset, so a
/// fade written before a recall is silently discarded: load, then set the fade,
/// then transition.
pub fn screen_take_time(screen: u8, up: bool) -> String {
    let dir = if up { "Up" } else { "Down" };
    format!("DeviceObject/$screenAuxGroup/@items/S{screen}/control/@props/take{dir}Time")
}

/// Apply pending layer changes. Required after changing layer parameters —
/// without it a foreground layer change may not be considered.
pub fn global_update() -> String {
    String::from("DeviceObject/$screenAuxGroup/control/@props/xUpdate")
}

// ---------------------------------------------------------------- presets

/// Recall a screen preset from bank slot `slot` (1–1000).
///
/// Note the nesting — slot, then screen, then target. The *save* path nests the
/// other way round.
pub fn load_screen_preset(slot: u16, screen: u8, target: Preset) -> String {
    let t = preset_key(target);
    format!(
        "DeviceObject/presetBank/control/load/$slot/@items/{slot}/$screen/@items/S{screen}/$preset/@items/{t}/@props/xRequest"
    )
}

/// Recall an auxiliary preset from bank slot `slot`.
pub fn load_aux_preset(slot: u16, aux: u8, target: Preset) -> String {
    let t = preset_key(target);
    format!(
        "DeviceObject/presetBank/control/load/$slot/@items/{slot}/$auxiliary/@items/A{aux}/$preset/@items/{t}/@props/xRequest"
    )
}

/// Recall a master preset from slot `slot` (1–500).
pub fn load_master_preset(slot: u16, target: Preset) -> String {
    let t = preset_key(target);
    format!(
        "DeviceObject/masterPresetBank/control/load/$slot/@items/{slot}/$preset/@items/{t}/@props/xRequest"
    )
}

/// The operator's name for a preset slot.
///
/// `$bank` (reading a preset) is a different object from `$slot` (recalling
/// one); they are not interchangeable.
pub fn preset_label(slot: u16) -> String {
    format!("DeviceObject/presetBank/$bank/@items/{slot}/control/@props/label")
}

/// Whether a preset slot holds anything.
pub fn preset_is_valid(slot: u16) -> String {
    format!("DeviceObject/presetBank/$bank/@items/{slot}/status/@props/isValid")
}

/// The operator's name for a master preset slot.
pub fn master_preset_label(slot: u16) -> String {
    format!("DeviceObject/masterPresetBank/$bank/@items/{slot}/control/@props/label")
}

/// Whether a master preset slot holds anything.
pub fn master_preset_is_valid(slot: u16) -> String {
    format!("DeviceObject/masterPresetBank/$bank/@items/{slot}/status/@props/isValid")
}

// ---------------------------------------------------------------- layers

/// The source on a screen layer: `LIVE_<n>`, `STILL_<n>`, `SCREEN_<n>`,
/// `NATIVE_<n>`, `COLOR`, or `NONE`.
///
/// `letter` comes from [`crate::Letters::letter`] — addressing this by the
/// wrong letter writes to the side that is on air.
pub fn layer_source(screen: u8, letter: char, layer: Layer) -> String {
    let l = layer.key();
    format!(
        "DeviceObject/$screen/@items/S{screen}/$preset/@items/{letter}/$layer/@items/{l}/source/@props/inputNum"
    )
}

/// The source on an auxiliary layer.
pub fn aux_layer_source(aux: u8, letter: char, layer: Layer) -> String {
    let l = layer.key();
    format!(
        "DeviceObject/$auxiliary/@items/A{aux}/$preset/@items/{letter}/$layer/@items/{l}/source/@props/inputNum"
    )
}

/// Layer capability in the staged configuration: `OFF`, `DUAL`, `4K`, `5K`.
pub fn layer_capability(screen: u8, layer: u16) -> String {
    format!(
        "DeviceObject/preconfig/resources/new/$screen/@items/S{screen}/$layer/@items/{layer}/control/@props/capability"
    )
}

// ---------------------------------------------------------------- sources

/// Input label.
///
/// Documented, but the whole `$input` subtree answered `E12` on an Aquilon C
/// running 6.2.73. Probe before relying on it.
pub fn input_label(input: u16) -> String {
    format!("DeviceObject/$input/@items/IN_{input}/control/@props/label")
}

/// Whether an input is enabled in the configuration.
pub fn input_is_enabled(input: u16) -> String {
    format!("DeviceObject/$input/@items/IN_{input}/status/@props/isEnabled")
}

/// Whether an input currently has a valid signal.
pub fn input_is_available(input: u16) -> String {
    format!("DeviceObject/$input/@items/IN_{input}/status/@props/isAvailable")
}

/// Still label.
pub fn still_label(still: u16) -> String {
    format!("DeviceObject/$still/@items/{still}/control/@props/label")
}

/// Whether a still slot holds an image.
pub fn still_is_used(still: u16) -> String {
    format!("DeviceObject/$still/@items/{still}/status/@props/isUsed")
}
