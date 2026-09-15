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

    /// The value that names this destination in a [`take_many`] list:
    /// `SCREEN_1` / `AUX_1` — a third spelling, used nowhere else.
    pub fn take_many_id(self) -> String {
        match self {
            Dest::Screen(n) => format!("SCREEN_{n}"),
            Dest::Aux(n) => format!("AUX_{n}"),
        }
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

/// Revert the last change made to the destination's layer settings — an
/// edit undo, which is what the vendor's manual means by Step Back on this
/// platform. Not LiveCore's return to the look before the last take: firing
/// it after a take moves nothing (Midra 4K simulator, 2026-09-15). A
/// trigger; the manual adds that it cannot undo a deletion.
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

/// Drive the T-bar by hand: `0`…`65535`, `0` at the DOWN end. The device
/// reports where it is in [`tbar_position`].
pub fn tbar_control(d: Dest) -> String {
    format!(
        "DeviceObject/transition/{}/control/@props/tbarPosition",
        d.item()
    )
}

/// Whether a take swaps the buffers (`true`, the default) or copies preview
/// to program and leaves preview as it was.
pub fn preset_toggle(d: Dest) -> String {
    format!(
        "DeviceObject/transition/{}/control/@props/enablePresetToggle",
        d.item()
    )
}

/// A list of [`Dest::take_many_id`]s, up to eight, on the take node's own
/// control — the shape of the vendor bundle's `SCREEN_AUX` enum.
///
/// **Unproven.** The property exists on the real unit and the simulators
/// accept the write and echo it, but nothing transitions on the simulator,
/// and the vendor's own Web RCS never writes it: its TAKE with every screen
/// selected fires one [`take`] per screen, back to back (watched on the
/// Midra 4K simulator, 2026-09-15). Do that instead until a unit shows what
/// this does.
pub fn take_many() -> String {
    String::from("DeviceObject/transition/control/@props/xTakeMany")
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

/// What a master save records — see [`save_master_preset`]. Set it before
/// firing the save; it stays set.
pub fn master_save_mode() -> String {
    String::from("DeviceObject/preset/masterBank/control/save/@props/mode")
}

/// Where a master save in `SAVE_FROM_PGM` / `SAVE_FROM_PRW` mode puts each
/// destination's buffer: a slot in that destination's own bank (screen bank
/// for a screen, aux bank for an auxiliary), which the master then refers to.
///
/// **This is how a master save overwrites screen memories.** Every
/// destination's `bankSlot` is `1` out of the box, so a master save from a
/// buffer writes every in-service screen into screen slot 1 and every
/// auxiliary into aux slot 1 — a real Pulse 4K lost screen memory 1 to a
/// disabled screen's 0×0 state this way (2026-09-12). Set these first, to
/// slots that are free, or use `USE_EXISTING_MEMORIES`, which records the
/// memories the buffers already hold and writes no bank slot at all.
pub fn master_save_bank_slot(d: Dest) -> String {
    format!(
        "DeviceObject/preset/masterBank/control/save/{}/@props/bankSlot",
        d.item()
    )
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

/// Any property of a live layer in a buffer, by the tail of its path —
/// `position/@props/posH`, `border/edge/color/@props/red` and so on. The
/// fifty-seven leaves and their ranges are the device's own; the named
/// builders below cover the ones a control surface reaches for first.
pub fn layer_prop(screen: u8, buffer: Buffer, layer: u8, tail: &str) -> String {
    format!(
        "DeviceObject/$screen/@items/{screen}/$preset/@items/{}/$liveLayer/@items/{layer}/{tail}",
        buffer.key()
    )
}

/// Horizontal position of a layer's **centre**, in screen pixels. There is
/// no anchor point on this platform: a full-screen layer on a 1920×1080
/// canvas reads `960`, `540`.
pub fn layer_pos_h(screen: u8, buffer: Buffer, layer: u8) -> String {
    layer_prop(screen, buffer, layer, "position/@props/posH")
}

/// Vertical position of a layer's centre. See [`layer_pos_h`].
pub fn layer_pos_v(screen: u8, buffer: Buffer, layer: u8) -> String {
    layer_prop(screen, buffer, layer, "position/@props/posV")
}

/// Layer width in pixels, `0`…`65535`.
pub fn layer_size_h(screen: u8, buffer: Buffer, layer: u8) -> String {
    layer_prop(screen, buffer, layer, "size/@props/sizeH")
}

/// Layer height in pixels.
pub fn layer_size_v(screen: u8, buffer: Buffer, layer: u8) -> String {
    layer_prop(screen, buffer, layer, "size/@props/sizeV")
}

/// Layer opacity, `0`…`256` — note the range: `256` is opaque.
pub fn layer_opacity(screen: u8, buffer: Buffer, layer: u8) -> String {
    layer_prop(screen, buffer, layer, "opacity/@props/opacity")
}

/// What the layer is doing: `OFF`, `OPEN`, `CLOSE`, `CROSS`, `FLYING`,
/// `FLYING_DEPTH`, `SLAVE`, `MASK` or `OUT_OF_CAPACITY`. Read-only.
pub fn layer_state(screen: u8, buffer: Buffer, layer: u8) -> String {
    layer_prop(screen, buffer, layer, "status/@props/state")
}

/// The screen's canvas width as the applied configuration built it. A
/// screen not in service reports `0`.
pub fn canvas_width(screen: u8) -> String {
    format!("DeviceObject/$screen/@items/{screen}/canvas/status/size/@props/sizeH")
}

/// The screen's canvas height. See [`canvas_width`].
pub fn canvas_height(screen: u8) -> String {
    format!("DeviceObject/$screen/@items/{screen}/canvas/status/size/@props/sizeV")
}

// ------------------------------------------------- freeze, faders, inputs, tallies
//
// Everything from here down is spelled from the Pulse 4K's own store — the
// `/api/stores/device` dump the field-test suite took on 2026-09-12 — using
// the same `xxxList/items/K` → `$xxx/@items/K`, `pp` → `@props` rule every
// path above follows, and answered by both simulators. None of it was in the
// AWJ sweep the hardware answered, so a `get` of these on a real unit is
// still owed; the docs say so.

/// Freeze a destination's output. A flag, not a trigger.
pub fn freeze(d: Dest) -> String {
    format!("DeviceObject/{}/control/@props/freeze", d.item())
}

/// Freeze one live layer of a screen. On the screen, not on a buffer: a
/// frozen layer stays frozen through a take.
pub fn layer_freeze(screen: u8, layer: u8) -> String {
    format!("DeviceObject/$screen/@items/{screen}/$liveLayer/@items/{layer}/control/@props/freeze")
}

/// A live layer's fader, `0`…`255` — a master over the layer's own opacity,
/// again per screen rather than per buffer. [`layer_fade_in`] and
/// [`layer_fade_out`] run it over the take time.
pub fn layer_fader(screen: u8, layer: u8) -> String {
    format!("DeviceObject/$screen/@items/{screen}/$liveLayer/@items/{layer}/fader/@props/opacity")
}

/// Fade a live layer up. A trigger.
pub fn layer_fade_in(screen: u8, layer: u8) -> String {
    format!("DeviceObject/$screen/@items/{screen}/$liveLayer/@items/{layer}/fader/@props/xFadeIn")
}

/// Fade a live layer out. A trigger.
pub fn layer_fade_out(screen: u8, layer: u8) -> String {
    format!("DeviceObject/$screen/@items/{screen}/$liveLayer/@items/{layer}/fader/@props/xFadeOut")
}

/// How many inputs the model carries, fitted or not. Every one exists in the
/// store; [`input_is_available`] says which are real on this unit.
pub const INPUTS: u8 = 16;

/// The item key of input `n`: `INPUT_<n>` — also the value a layer's
/// [`layer_source`] takes.
pub fn input_key(n: u8) -> String {
    format!("INPUT_{n}")
}

/// Whether input `n` exists on this unit (a Pulse 4K has ten of the model's
/// sixteen).
pub fn input_is_available(n: u8) -> String {
    format!("DeviceObject/$input/@items/INPUT_{n}/status/@props/isAvailable")
}

/// The front-panel LED for input `n`: `OFF`, `RED`, `GREEN` or
/// `ORANGE_BLINK`. `GREEN` is a signal present on the active plug.
pub fn input_led(n: u8) -> String {
    format!("DeviceObject/$input/@items/INPUT_{n}/status/@props/ledColor")
}

/// Which of input `n`'s plugs is active, `"1"`…`"4"` — a string, as the
/// device spells it.
pub fn input_plug(n: u8) -> String {
    format!("DeviceObject/$input/@items/INPUT_{n}/control/@props/plug")
}

/// Freeze input `n` wherever it is shown.
pub fn input_freeze(n: u8) -> String {
    format!("DeviceObject/$input/@items/INPUT_{n}/control/@props/freeze")
}

/// Black input `n` wherever it is shown.
pub fn input_black(n: u8) -> String {
    format!("DeviceObject/$input/@items/INPUT_{n}/control/@props/black")
}

/// The operator's name for a plug of input `n`. Labels live on plugs, not
/// inputs: read the active plug's ([`input_plug`]).
pub fn plug_label(n: u8, plug: u8) -> String {
    format!("DeviceObject/$input/@items/INPUT_{n}/$plug/@items/{plug}/control/@props/label")
}

/// The plug's connector: `HDMI`, `SDI`, `DISPLAY_PORT`…
pub fn plug_type(n: u8, plug: u8) -> String {
    format!("DeviceObject/$input/@items/INPUT_{n}/$plug/@items/{plug}/status/@props/type")
}

/// Whether the plug carries a usable signal.
pub fn plug_signal_is_valid(n: u8, plug: u8) -> String {
    format!("DeviceObject/$input/@items/INPUT_{n}/$plug/@items/{plug}/status/signal/@props/isValid")
}

/// The signal's format as the device names it — `HDTV 1080p 50Hz`, or
/// `No Signal`.
pub fn plug_format_name(n: u8, plug: u8) -> String {
    format!("DeviceObject/$input/@items/INPUT_{n}/$plug/@items/{plug}/status/signal/@props/formatName")
}

/// The four on-air lists the device keeps for its inputs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TallyBus {
    /// Inputs on some screen's program.
    ScreenProgram,
    /// Inputs on some screen's preview.
    ScreenPreview,
    /// Inputs on some auxiliary's program.
    AuxProgram,
    /// Inputs on some auxiliary's preview.
    AuxPreview,
}

/// The inputs currently on a bus, as a list of `INPUT_<n>` keys. Read-only,
/// kept by the device — a tally that needs no bookkeeping on the client.
pub fn tally_inputs(bus: TallyBus) -> String {
    let prop = match bus {
        TallyBus::ScreenProgram => "usedOnScreenPgm",
        TallyBus::ScreenPreview => "usedOnScreenPrw",
        TallyBus::AuxProgram => "usedOnAuxPgm",
        TallyBus::AuxPreview => "usedOnAuxPrw",
    };
    format!("DeviceObject/tallies/inputs/@props/{prop}")
}

// ------------------------------------------ background, top frame, stills, snapshots
//
// Also from the store dump. A screen's preset carries two more layers beside
// the live ones: a **background** (one of eight background sets, or a
// colour) and a **top** frame (one of four frame slots the screen holds),
// each with its own opacity, mask and transitions. The frame slots point
// into the still library, and the device serves a picture of each.

/// A property of a buffer's background layer, by the tail of its path —
/// `source/@props/set` (`"1"`…`"8"`, a string), `opacity/@props/opacity`
/// (0…256), `color/@props/red`, `status/@props/state`…
pub fn background_prop(screen: u8, buffer: Buffer, tail: &str) -> String {
    format!(
        "DeviceObject/$screen/@items/{screen}/$preset/@items/{}/background/{tail}",
        buffer.key()
    )
}

/// A property of a buffer's top-frame layer — `source/@props/frame`
/// (`NONE` or `"1"`…`"4"`), `opacity/@props/opacity`, `position/@props/posH`…
/// The frame is drawn at the frame slot's own size; there is no size here.
pub fn top_prop(screen: u8, buffer: Buffer, tail: &str) -> String {
    format!(
        "DeviceObject/$screen/@items/{screen}/$preset/@items/{}/top/{tail}",
        buffer.key()
    )
}

/// What a screen's background set shows in its simplest mode: `NONE`, an
/// input, or `PRESET_FRAME_<n>` — one of the screen's back frames.
pub fn background_set_content(screen: u8, set: u8) -> String {
    format!("DeviceObject/$screen/@items/{screen}/$backgroundSet/@items/{set}/control/@props/singleContent")
}

/// A screen's frame slots, `1`…`4`, in two lists: the back frames a
/// background set can show and the top frames the top layer can. Each
/// points at a still-library slot and reports whether it holds anything.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameList {
    Back,
    Top,
}

impl FrameList {
    fn list(self) -> &'static str {
        match self {
            FrameList::Back => "$backFrame",
            FrameList::Top => "$topFrame",
        }
    }
    /// The segment the snapshot route uses for this list.
    pub fn snapshot_kind(self) -> &'static str {
        match self {
            FrameList::Back => "back",
            FrameList::Top => "top",
        }
    }
}

/// Whether a frame slot holds an image.
pub fn frame_is_valid(screen: u8, list: FrameList, slot: u8) -> String {
    format!(
        "DeviceObject/$screen/@items/{screen}/{}/@items/{slot}/status/@props/isValid",
        list.list()
    )
}

/// The operator's name for a frame slot.
pub fn frame_label(screen: u8, list: FrameList, slot: u8) -> String {
    format!(
        "DeviceObject/$screen/@items/{screen}/{}/@items/{slot}/control/@props/label",
        list.list()
    )
}

/// Which still-library slot a frame slot shows, as a string.
pub fn frame_library_slot(screen: u8, list: FrameList, slot: u8) -> String {
    format!(
        "DeviceObject/$screen/@items/{screen}/{}/@items/{slot}/control/@props/librarySlot",
        list.list()
    )
}

/// A frame slot's width or height as set on the screen (`sizeH` / `sizeV`).
pub fn frame_size(screen: u8, list: FrameList, slot: u8, prop: &str) -> String {
    format!(
        "DeviceObject/$screen/@items/{screen}/{}/@items/{slot}/control/@props/{prop}",
        list.list()
    )
}

/// Whether input `n` keeps a snapshot for the HTTP route below. On the real
/// unit every fitted input had this on already.
pub fn input_snapshot_enable(n: u8) -> String {
    format!("DeviceObject/$input/@items/INPUT_{n}/snapshot/@props/enable")
}

/// The path, on the device's own HTTP server (port 80 on a unit), of a
/// snapshot: `kind` is `inputs`, `outputs` or `multiviewer` with a number, or
/// `screens/<n>/back|top` with a frame slot. Read from the vendor's route
/// table; a live picture of a screen's program or preview is not served.
pub fn snapshot_http_path(kind: &str, id: u8) -> String {
    format!("/api/device/snapshots/{kind}/{id}")
}

// ------------------------------------------------------------ quick preset
//
// The device's emergency key: one switch that puts fade-to-black, a library
// image or a master memory on the selected program outputs, and takes it off
// again. `control/@props/enable` is the switch; `status` says what is on.

/// The quick preset switch. `true` puts it on air on every destination its
/// filter includes; `false` returns each to what Live had.
pub fn quick_preset_enable() -> String {
    String::from("DeviceObject/quickPreset/control/@props/enable")
}

/// What the switch shows: `NULL` is fade to black, `FRAME` a library image,
/// `MASTER` a master memory.
pub fn quick_preset_mode() -> String {
    String::from("DeviceObject/quickPreset/control/@props/mode")
}

/// Whether the quick preset is on air, as the device reports it.
pub fn quick_preset_is_enabled() -> String {
    String::from("DeviceObject/quickPreset/status/@props/isEnabled")
}

/// Whether a destination is covered by the quick preset.
pub fn quick_preset_filter(d: Dest) -> String {
    format!("DeviceObject/quickPreset/control/filter/{}/@props/enable", d.item())
}

/// Whether the quick preset is on this destination right now.
pub fn quick_preset_on(d: Dest) -> String {
    format!("DeviceObject/quickPreset/status/{}/@props/isEnabled", d.item())
}

/// The master memory the `MASTER` mode recalls.
pub fn quick_preset_master_slot() -> String {
    String::from("DeviceObject/quickPreset/control/mode/master/@props/bankSlot")
}

// ------------------------------------------------------------------ system

/// Serial number.
pub fn serial_number() -> String {
    String::from("DeviceObject/system/serial/@props/serialNumber")
}

/// The unit's overall temperature alarm: `NONE`, or a level.
pub fn temperature_alarm() -> String {
    String::from("DeviceObject/system/temperature/device/@props/alarm")
}

/// The sensors a Pulse 4K reports, in the order the store lists them.
pub const SENSORS: [&str; 14] = [
    "CM_INTAKE", "CM_OUTTAKE", "CF_MEZZA_RJ45_IN", "CF_MEZZA_RJ45_OUT", "CF_MEZZA_AUDIO",
    "CF_OPT_VIDEO_OPTION_1", "CF_OPT_VIDEO_OPTION_2", "FPGA_BALERION", "FPGA_MERAXES",
    "FPGA_VIDEO_OPT_1_SCALER", "FPGA_VIDEO_OPT_1_IO", "FPGA_VIDEO_OPT_2_SCALER",
    "FPGA_VIDEO_OPT_2_IO", "VEGA",
];

/// A sensor's reading in **hundredths of a degree** (`3010` is 30.1 °C), or
/// its `isAvailable` / `alarm` — `prop` picks which.
pub fn sensor(name: &str, prop: &str) -> String {
    format!("DeviceObject/system/temperature/$sensor/@items/{name}/@props/{prop}")
}

/// A case fan's `speed`, `alarm` or `isAvailable`, fans `1`…`4`.
pub fn case_fan(n: u8, prop: &str) -> String {
    format!("DeviceObject/system/fan/$case/@items/{n}/@props/{prop}")
}

/// Front-panel lock: `NONE`, `MENU` or `ALL`.
pub fn front_panel_lock() -> String {
    String::from("DeviceObject/system/frontPanel/@props/lock")
}

/// Front-panel LCD brightness (`1`…`7` on a Pulse 4K) or key brightness
/// (`0`…`100`) — `prop` is `lcdBrightness` or `keyBrightness`.
pub fn front_panel(prop: &str) -> String {
    format!("DeviceObject/system/frontPanel/@props/{prop}")
}

/// The network hostname.
pub fn hostname() -> String {
    String::from("DeviceObject/system/network/adapter/@props/hostname")
}

/// A running IPv4 value — `ip`, `gateway`, `dns` (four-byte lists) or
/// `netmask` (a prefix length).
pub fn ipv4_status(prop: &str) -> String {
    format!("DeviceObject/system/network/ipv4/status/@props/{prop}")
}

/// Whether the unit takes its address from DHCP.
pub fn ipv4_dhcp() -> String {
    String::from("DeviceObject/system/network/ipv4/control/@props/enableDhcp")
}

/// Reboot the unit. A trigger.
pub fn reboot() -> String {
    String::from("DeviceObject/system/shutdown/@props/xReboot")
}

/// Whether the unit is in standby.
pub fn standby_is_on() -> String {
    String::from("DeviceObject/system/shutdown/standby/status/@props/isStandbyOn")
}

// ------------------------------------------------------------- multiviewer
//
// One multiviewer on this platform, on the output keyed `MTVW`: up to twenty
// widgets (the model says how many are real), each a window with a source,
// and twenty layout memories. Same shape as LiveCore's monitoring output.

/// The output the multiviewer leaves on. Not a number, unlike the others.
pub const MULTIVIEWER_OUTPUT: &str = "MTVW";

/// The most widget slots the object model carries: 27 on an Alta 4K, 20 on a
/// Midra 4K (slot 21 answers `E12` there). [`mvw_widget_validity`] says which
/// of them this unit can use — 16 on a Pulse 4K.
pub const MVW_WIDGETS: u8 = 27;

/// A widget's control property: `enable`, `source`, `posH`, `posV` (top-left,
/// in multiviewer output pixels), `sizeH`, `sizeV`, or `displayOsd`
/// (`OFF` / `BASIC` / `DETAILED`).
pub fn mvw_widget(n: u8, prop: &str) -> String {
    format!("DeviceObject/multiviewer/$widget/@items/{n}/control/@props/{prop}")
}

/// A widget's status: `isEnabled`, `isDuplicated`, `isOverlapped`, or the
/// geometry as laid out.
pub fn mvw_widget_status(n: u8, prop: &str) -> String {
    format!("DeviceObject/multiviewer/$widget/@items/{n}/status/@props/{prop}")
}

/// What a widget may show, as the device lists it: `NONE`, the fitted inputs,
/// `SCREEN_PRGM_<n>` / `SCREEN_PRW_<n>` and `TIMER_<n>`.
pub fn mvw_source_validity() -> String {
    String::from("DeviceObject/multiviewer/status/@props/sourceValidity")
}

/// Which widget slots this unit can use.
pub fn mvw_widget_validity() -> String {
    String::from("DeviceObject/multiviewer/status/@props/widgetValidity")
}

/// Whether a multiviewer layout memory holds anything, `1`…`20`.
pub fn mvw_preset_is_valid(slot: u8) -> String {
    format!("DeviceObject/multiviewer/$bank/@items/{slot}/status/@props/isValid")
}

/// A layout memory's label.
pub fn mvw_preset_label(slot: u8) -> String {
    format!("DeviceObject/multiviewer/$bank/@items/{slot}/control/@props/label")
}

/// Erase a layout memory. A trigger.
pub fn mvw_preset_delete(slot: u8) -> String {
    format!("DeviceObject/multiviewer/$bank/@items/{slot}/control/@props/xDelete")
}

/// Recall a layout memory. A trigger.
pub fn mvw_load(slot: u8) -> String {
    format!("DeviceObject/multiviewer/$bank/control/load/$slot/@items/{slot}/@props/xRequest")
}

/// Store the current layout in a memory. A trigger; what it records is the
/// `categoryFilter` on `multiviewer/$bank/control/save`.
pub fn mvw_save(slot: u8) -> String {
    format!("DeviceObject/multiviewer/$bank/control/save/$slot/@items/{slot}/@props/xRequest")
}

// ------------------------------------------------------------------ timers

/// Three timers a multiviewer widget can show.
pub const TIMERS: u8 = 3;

/// A timer's control property: `type` (`CURRENT_TIME` / `COUNTDOWN` /
/// `STOPWATCH`), `label`, `countdownDuration` (seconds), `currentTimeMode`,
/// or the triggers `xStart`, `xPause`, `xStop`.
pub fn timer(n: u8, prop: &str) -> String {
    format!("DeviceObject/$timer/@items/TIMER_{n}/control/@props/{prop}")
}

/// A timer's state: `IDLE`, or running.
pub fn timer_state(n: u8) -> String {
    format!("DeviceObject/$timer/@items/TIMER_{n}/status/@props/state")
}

// ---------------------------------------------------------- still library

/// Library slots, `1`…`50`.
pub const STILL_SLOTS: u8 = 50;

/// A library slot's status: `isValid`, `isUsed`, `fileName`, `fileSize`,
/// `width`, `height`.
pub fn still_status(slot: u8, prop: &str) -> String {
    format!("DeviceObject/stillLibrary/$bank/@items/{slot}/status/@props/{prop}")
}

/// A library slot's label.
pub fn still_label(slot: u8) -> String {
    format!("DeviceObject/stillLibrary/$bank/@items/{slot}/control/@props/label")
}

/// Erase a library slot. A trigger.
pub fn still_delete(slot: u8) -> String {
    format!("DeviceObject/stillLibrary/$bank/@items/{slot}/control/@props/xDelete")
}

/// The capture command's properties: `stream` (an input, output or `MTVW`),
/// `destination` (`LIBRARY` / `FILE`), `libraryMode` (`AUTO_SLOT` /
/// `SPECIFIC_SLOT`), `librarySlot`, `fileType` (`PNG` / `BMP` / `JPEG`),
/// `mode` (`INCREMENTAL` / `OVERWRITE`), and the trigger `xRequest`.
pub fn capture_cmd(prop: &str) -> String {
    format!("DeviceObject/stillLibrary/capture/cmd/@props/{prop}")
}

/// The capture's status: `status` (`DONE`, `FAILED`, `NO_ACTIVE_INPUT`,
/// `INPUT_NO_SIGNAL`…), `fileName`, `streamValidity`.
pub fn capture_status(prop: &str) -> String {
    format!("DeviceObject/stillLibrary/capture/status/@props/{prop}")
}

// ----------------------------------------------------------------- outputs

/// The outputs a Pulse 4K carries: six numbered and the multiviewer's.
pub const OUTPUTS: [&str; 7] = ["1", "2", "3", "4", "5", "6", MULTIVIEWER_OUTPUT];

/// What an output is for in the applied configuration: `DISABLE`, `AUX`,
/// `AUX_INPUT_AND_PROGRAM`, `AUX_INPUT_ONLY`, `MULTIVIEWER` or
/// `SCREEN_FORMAT`. Decides which of the three format nodes applies.
pub fn output_role(key: &str) -> String {
    format!("{CURRENT}/$output/@items/{key}/@props/mode")
}

/// An output's status: `isAvailable`, `isValid`, `format`, `rate`, `sizeH`,
/// `sizeV`, `ledColor`, `isFormatInterlaced`…
pub fn output_status(key: &str, prop: &str) -> String {
    format!("DeviceObject/$output/@items/{key}/status/@props/{prop}")
}

/// The operator's name for an output.
pub fn output_label(key: &str) -> String {
    format!("DeviceObject/$output/@items/{key}/control/@props/label")
}

/// Which format node an output's role uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputRole {
    Screen,
    Auxiliary,
    Multiviewer,
}

impl OutputRole {
    /// From the applied configuration's `mode` word.
    pub fn parse(mode: &str) -> Option<OutputRole> {
        match mode {
            "SCREEN_FORMAT" => Some(OutputRole::Screen),
            "MULTIVIEWER" => Some(OutputRole::Multiviewer),
            m if m.starts_with("AUX") => Some(OutputRole::Auxiliary),
            _ => None,
        }
    }
    fn node(self) -> &'static str {
        match self {
            OutputRole::Screen => "screen",
            OutputRole::Auxiliary => "auxiliary",
            OutputRole::Multiviewer => "multiviewer",
        }
    }
}

/// The format an output is set to, on the node its role uses. Write it, then
/// [`output_format_update`].
pub fn output_format(key: &str, role: OutputRole) -> String {
    format!("DeviceObject/$output/@items/{key}/format/{}/control/@props/format", role.node())
}

/// Apply a format change. A trigger.
pub fn output_format_update(key: &str, role: OutputRole) -> String {
    format!("DeviceObject/$output/@items/{key}/format/{}/control/@props/xUpdate", role.node())
}

/// The formats an output accepts in its role.
pub fn output_format_validity(key: &str, role: OutputRole) -> String {
    format!("DeviceObject/$output/@items/{key}/format/{}/status/@props/formatValidity", role.node())
}

/// An output's picture settings: `gamma` (5…40, tenths), `brightness`,
/// `contrast`, `saturation` (−128…127), `hue` (−90…90), `gainR/G/B`,
/// `offsetR/G/B`.
pub fn output_setting(key: &str, prop: &str) -> String {
    format!("DeviceObject/$output/@items/{key}/settings/@props/{prop}")
}

/// The test pattern: `type` is one of `NO_PATTERN`, `COLOR`, grey scales,
/// colour bars, grids, `SMPTE`, bursts, gradients, `CHECKERBOARD`,
/// `SOFTEDGE`, `PATHOLOGICAL`; `inhibit` true keeps it off the output.
pub fn output_pattern(key: &str, prop: &str) -> String {
    format!("DeviceObject/$output/@items/{key}/pattern/control/@props/{prop}")
}

/// A plug's status on an output: `plugStatus` (`ACTIVE`…) or `type`.
pub fn output_plug_status(key: &str, plug: u8, prop: &str) -> String {
    format!("DeviceObject/$output/@items/{key}/$plug/@items/{plug}/status/@props/{prop}")
}

/// A plug's settings on an output: `enableHdcp` (`DISABLE` / `AUTO` /
/// `HDCP_1X` / `HDCP_2X_TYPE_0` / `HDCP_2X_TYPE_1`), `pixelEncoding` (from
/// the status `pixelEncodingFormatValidity`), `sdiTransport` (`LEVEL_A` /
/// `LEVEL_B`), `forceDviMode`.
pub fn output_plug_control(key: &str, plug: u8, prop: &str) -> String {
    format!("DeviceObject/$output/@items/{key}/$plug/@items/{plug}/control/@props/{prop}")
}

/// Embedded audio on an output plug: `DISABLE`, `AUTO`, `2_CHANNELS` …
/// `8_CHANNELS`, from the plug's `audio/status/@props/modeValidity`.
pub fn output_plug_audio_mode(key: &str, plug: u8) -> String {
    format!("DeviceObject/$output/@items/{key}/$plug/@items/{plug}/audio/control/@props/mode")
}

/// The EDID of the display on an output plug: `isAvailable`, `isValid`,
/// `data` (the 256 bytes), `hashCode`. Read-only; save it into the library
/// with [`edid_edit`] + [`edid_save`] to present it on an input.
pub fn output_plug_edid(key: &str, plug: u8, prop: &str) -> String {
    format!("DeviceObject/$output/@items/{key}/$plug/@items/{plug}/edid/status/@props/{prop}")
}

/// An output's area of interest — the part of its format the screen's canvas
/// fills: `mode` (`FIT_FORMAT` / `CUSTOM`), `overscan`, `top`, `left`,
/// `width`, `height` in thousandths of the format (`100000` = all of it), and
/// the trigger `xUpdate` that applies them.
pub fn output_aoi(key: &str, prop: &str) -> String {
    format!("DeviceObject/$output/@items/{key}/canvas/aoi/@props/{prop}")
}

/// Pitch compensation for LED walls: `pitchRatioH` / `pitchRatioV` (×1000)
/// and the trigger `xUpdate`. Answered by the real Pulse 4K in the field
/// test sweep.
pub fn output_pitch(key: &str, prop: &str) -> String {
    format!("DeviceObject/$output/@items/{key}/canvas/pitch/@props/{prop}")
}

/// The output canvas as built: `aoiWidth`, `aoiHeight`, `pitchedWidth`,
/// `pitchedHeight`, `maxWidth`, `maxHeight`, `isUsedInScreen`, `top`, `left`.
pub fn output_canvas_status(key: &str, prop: &str) -> String {
    format!("DeviceObject/$output/@items/{key}/canvas/status/@props/{prop}")
}

/// An output's HDR: `mode` (`AUTO` / `SDR` / `HDR10` / `HLG`) and `nitLevel`
/// (`AUTO` or `<n>_NITS`).
pub fn output_hdr(key: &str, prop: &str) -> String {
    format!("DeviceObject/$output/@items/{key}/hdr/control/@props/{prop}")
}

/// What the output is sending: `mode`, `nitLevel`, `warning`.
pub fn output_hdr_status(key: &str, prop: &str) -> String {
    format!("DeviceObject/$output/@items/{key}/hdr/status/@props/{prop}")
}

// ---------------------------------------------------------- custom formats

/// Custom output format slots, `1`…`16`.
pub const CUSTOM_FORMATS: u8 = 16;

/// The custom-format editor's settings: `mode` (`CVT` / `FULL`), `userName`,
/// `cvtReducedBlk`, `fullCvtHutil` / `fullCvtVutil` (active size),
/// `fullCvtRate` (mHz), and in `FULL` mode the sync widths, porches and
/// polarities (`fullHsync`, `fullHbackPorch`, `fullHfrontPorch`,
/// `fullHsyncPol`, and the `V` set).
pub fn custom_format_setting(prop: &str) -> String {
    format!("DeviceObject/customFormats/create/settings/@props/{prop}")
}

/// The editor's triggers: `xCheck` validates the timing, `xReset` clears it.
pub fn custom_format_control(prop: &str) -> String {
    format!("DeviceObject/customFormats/create/control/@props/{prop}")
}

/// The editor's verdict: `checkStatus` (`NEVER_CHECKED` / `CHECKED` /
/// `MODIFIED`), `checkResult` (`VALID` / `INVALID`), `displayName`,
/// `hTotal`, `vTotal`, `pixelFrequency`, `lineFrequency`.
pub fn custom_format_status(prop: &str) -> String {
    format!("DeviceObject/customFormats/create/status/@props/{prop}")
}

/// File the checked timing in a slot. A trigger.
pub fn custom_format_save(slot: u8) -> String {
    format!("DeviceObject/customFormats/create/save/$bank/@items/{slot}/@props/xRequest")
}

/// A slot's control: `userName`, or the trigger `xDelete`.
pub fn custom_format_slot(slot: u8, prop: &str) -> String {
    format!("DeviceObject/customFormats/$bank/@items/{slot}/control/@props/{prop}")
}

/// A slot's status: `isValid`, `displayName`, `hUtil`, `vUtil`, `rate`,
/// `mode` and the full timing.
pub fn custom_format_slot_status(slot: u8, prop: &str) -> String {
    format!("DeviceObject/customFormats/$bank/@items/{slot}/status/@props/{prop}")
}

// ------------------------------------------------------------- input plugs

/// Whether a plug exists on input `n`.
pub fn plug_is_available(n: u8, plug: u8) -> String {
    format!("DeviceObject/$input/@items/INPUT_{n}/$plug/@items/{plug}/status/@props/isAvailable")
}

/// A plug's control: `signalType` (from the status `signalTypeValidity`),
/// `enableHdcp` (from `hdcpValidity`), `enableCropFinder`, `label`.
pub fn plug_control(n: u8, plug: u8, prop: &str) -> String {
    format!("DeviceObject/$input/@items/INPUT_{n}/$plug/@items/{plug}/control/@props/{prop}")
}

/// A plug's status: `type`, `signalTypeValidity`, `hdcpValidity`,
/// `canUseLutProcessing`.
pub fn plug_status(n: u8, plug: u8, prop: &str) -> String {
    format!("DeviceObject/$input/@items/INPUT_{n}/$plug/@items/{plug}/status/@props/{prop}")
}

/// The signal on a plug: `isValid`, `formatName`, `currentFormat`,
/// `scanType`, `formatWidth`, `formatHeight`, `fieldFrequency`, `colorSpace`.
pub fn plug_signal(n: u8, plug: u8, prop: &str) -> String {
    format!("DeviceObject/$input/@items/INPUT_{n}/$plug/@items/{plug}/status/signal/@props/{prop}")
}

/// Any setting of a plug by the tail of its path under `settings`:
/// `color/@props/brightness`, `processing/@props/sharpness`,
/// `aspect/@props/transformTo`, `cropping/control/@props/top`,
/// `keying/control/@props/mode`, `keying/chroma/@props/hue`,
/// `keying/luma/@props/luma`, `keying/cutNFill/control/@props/curve`,
/// `keying/assistant/@props/xGrab`, `@props/xReset` and so on.
pub fn plug_setting(n: u8, plug: u8, tail: &str) -> String {
    format!("DeviceObject/$input/@items/INPUT_{n}/$plug/@items/{plug}/settings/{tail}")
}

/// The keyer's mode on a plug: `DISABLE`, `CHROMA`, `LUMA`, `CUT_AND_FILL`.
/// [`input_keying_is_available`] says whether the input has a keyer at all
/// and [`input_cut_fill_is_available`] whether it can be a fill.
pub fn plug_keying_mode(n: u8, plug: u8) -> String {
    plug_setting(n, plug, "keying/control/@props/mode")
}

/// Whether input `n` carries a chroma / luma keyer.
pub fn input_keying_is_available(n: u8) -> String {
    format!("DeviceObject/$input/@items/INPUT_{n}/status/keying/@props/isAvailable")
}

/// Whether input `n` can be the fill of a cut-and-fill pair — the cut is the
/// next input, which the plug's `keying/cutNFill/status/@props/source` names.
pub fn input_cut_fill_is_available(n: u8) -> String {
    format!("DeviceObject/$input/@items/INPUT_{n}/status/keying/cutNFill/@props/isAvailable")
}

/// A plug's HDR handling: `mode` (`AUTO` / `SDR` / `HDR10` / `HLG`),
/// `nitLevel`.
pub fn plug_hdr(n: u8, plug: u8, prop: &str) -> String {
    format!("DeviceObject/$input/@items/INPUT_{n}/$plug/@items/{plug}/control/hdr/@props/{prop}")
}

/// What the plug sees: `mode`, `nitLevel`, `warning`.
pub fn plug_hdr_status(n: u8, plug: u8, prop: &str) -> String {
    format!("DeviceObject/$input/@items/INPUT_{n}/$plug/@items/{plug}/status/hdr/@props/{prop}")
}

/// The EDID a plug presents to its source, as 256 bytes. Write here to
/// change it — typically the `data` of a library entry.
pub fn plug_edid_cmd(n: u8, plug: u8) -> String {
    format!("DeviceObject/$input/@items/INPUT_{n}/$plug/@items/{plug}/edid/cmd/@props/data")
}

/// The EDID a plug is presenting, as 256 bytes. Read-only.
pub fn plug_edid_status(n: u8, plug: u8) -> String {
    format!("DeviceObject/$input/@items/INPUT_{n}/$plug/@items/{plug}/edid/status/@props/data")
}

/// The extension blocks of a plug's EDID, `BLOCK_1`…`BLOCK_3`:
/// `extensionType` (`CEA_861` / `UNKNOWN`), `isHdmiCompatible`,
/// `isAudioCompatible`, `isHdrCompatible`, `prefFormatName`.
pub fn plug_edid_extension(n: u8, plug: u8, block: u8, prop: &str) -> String {
    format!("DeviceObject/$input/@items/INPUT_{n}/$plug/@items/{plug}/edid/status/$extension/@items/BLOCK_{block}/@props/{prop}")
}

// ------------------------------------------------------------ EDID library

/// User slots in the EDID library, `1`…`64`; the factory entries beside them
/// are keyed by name (`DEFAULT_HDMI_2_0`, `DEFAULT_DP_UHD60`…).
pub const EDID_SLOTS: u8 = 64;

/// A library entry's control: `label`, `xRequestPrefFormat`, and the
/// triggers `xUpdate`, `xDelete`. The key is a slot number or a factory name.
pub fn edid_bank(key: &str, prop: &str) -> String {
    format!("DeviceObject/system/edid/$bank/@items/{key}/control/@props/{prop}")
}

/// A library entry's status: `isAvailable`, `isProtected` (factory),
/// `productName`, `prefFormatName`, `hid`, `dataSize`, `data`.
pub fn edid_bank_status(key: &str, prop: &str) -> String {
    format!("DeviceObject/system/edid/$bank/@items/{key}/status/@props/{prop}")
}

/// The EDID editor: `label` and `data`. [`edid_save`] files it in a slot,
/// [`edid_load`] fills it from one.
pub fn edid_edit(prop: &str) -> String {
    format!("DeviceObject/system/edid/edit/control/@props/{prop}")
}

/// What the editor holds, decoded: `productName`, `serialNumber`,
/// `prefFormatAvailable`, `hashCode`.
pub fn edid_edit_status(prop: &str) -> String {
    format!("DeviceObject/system/edid/edit/status/@props/{prop}")
}

/// Save the editor into a user slot. A trigger.
pub fn edid_save(slot: u8) -> String {
    format!("DeviceObject/system/edid/save/$bank/@items/{slot}/@props/xRequest")
}

/// Load a user slot into the editor. A trigger.
pub fn edid_load(slot: u8) -> String {
    format!("DeviceObject/system/edid/load/$bank/@items/{slot}/@props/xRequest")
}

// --------------------------------------------------------- screen canvases

/// How a screen is built from its outputs: `SINGLE_OUT`, `GRID` or `FREE`,
/// from `status/@props/modeValidity`.
pub fn screen_mode(screen: u8) -> String {
    format!("DeviceObject/$screen/@items/{screen}/control/@props/mode")
}

/// The modes the applied configuration allows a screen.
pub fn screen_mode_validity(screen: u8) -> String {
    format!("DeviceObject/$screen/@items/{screen}/status/@props/modeValidity")
}

/// Whether the outputs of a screen's canvas overlap.
pub fn screen_canvas_has_overlap(screen: u8) -> String {
    format!("DeviceObject/$screen/@items/{screen}/canvas/status/@props/hasOverlapWarning")
}

/// A grid canvas: `columnQty`, `rowQty`, `emptyCellWidth`, `emptyCellHeight`
/// and the trigger `xUpdate` (plus `xSoftedgeUpdate` on models that blend).
pub fn screen_grid(screen: u8, prop: &str) -> String {
    format!("DeviceObject/$screen/@items/{screen}/canvas/grid/control/@props/{prop}")
}

/// The grid as built: `columnQty`, `rowQty`.
pub fn screen_grid_status(screen: u8, prop: &str) -> String {
    format!("DeviceObject/$screen/@items/{screen}/canvas/grid/status/@props/{prop}")
}

/// Where an output sits in a screen's grid: `column`, `row` (strings, `"1"`…).
pub fn screen_grid_output(screen: u8, output: &str, prop: &str) -> String {
    format!("DeviceObject/$screen/@items/{screen}/canvas/grid/$output/@items/{output}/control/@props/{prop}")
}

/// The gap after column / row `i` of a grid, in pixels (negative overlaps).
pub fn screen_grid_spacing(screen: u8, dim: GridDim, i: u8) -> String {
    format!("DeviceObject/$screen/@items/{screen}/canvas/grid/${}Spacing/@items/{i}/control/@props/size", dim.word())
}

/// A grid's two dimensions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GridDim {
    Column,
    Row,
}

impl GridDim {
    fn word(self) -> &'static str {
        match self {
            GridDim::Column => "column",
            GridDim::Row => "row",
        }
    }
}

/// Apply a free canvas. A trigger.
pub fn screen_free_update(screen: u8) -> String {
    format!("DeviceObject/$screen/@items/{screen}/canvas/free/control/@props/xUpdate")
}

/// A free canvas's size: `mode` (`AUTO` / `CUSTOM`), `sizeH`, `sizeV`.
pub fn screen_free_size(screen: u8, prop: &str) -> String {
    format!("DeviceObject/$screen/@items/{screen}/canvas/free/control/size/@props/{prop}")
}

/// Where an output's top-left corner sits on a free canvas: `left`, `top`.
pub fn screen_free_output(screen: u8, output: &str, prop: &str) -> String {
    format!("DeviceObject/$screen/@items/{screen}/canvas/free/control/$output/@items/{output}/@props/{prop}")
}

/// A screen's test pattern: `type` (`NONE`, `GEOMETRIC`, grey scales, colour
/// bars, `GRID_CUSTOM`, `SMPTE`, gradients, `CROSSHATCH`, `CHECKERBOARD`,
/// `SOFTEDGE`, `THIRTY_BPP_1/2`) and `inhibit`.
pub fn screen_pattern(screen: u8, prop: &str) -> String {
    format!("DeviceObject/$screen/@items/{screen}/pattern/control/@props/{prop}")
}

// --------------------------------------------------------------- preconfig

/// The preconfiguration's triggers: `xCompute` works out the pipeline from
/// the working configuration, `xApply` rebuilds the device to it (every
/// output goes dark for a few seconds), `xCopyFromCurrent` fills the working
/// configuration from what is applied.
pub fn preconfig_control(prop: &str) -> String {
    format!("DeviceObject/preconfig/control/@props/{prop}")
}

/// The template: `select` (from the status `templateValidity` — `MIXER`,
/// `MATRIX`, and on some models `BLEND`, `BLEND_VERTICAL`) and the trigger
/// `xLoad`.
pub fn preconfig_template(prop: &str) -> String {
    format!("DeviceObject/preconfig/control/template/@props/{prop}")
}

/// A layer resource (scaler) `1`…`4`: `mode` (`DISABLE` / `SEAMLESS` for one
/// layer / `SPLIT` for two) and `useOnScreen`.
pub fn preconfig_resource(n: u8, prop: &str) -> String {
    format!("DeviceObject/preconfig/control/$resources/@items/{n}/@props/{prop}")
}

/// An output in the working configuration: `mode` (`DISABLE`, `SCREEN_FORMAT`,
/// `AUX`, `AUX_INPUT_AND_PROGRAM`, `AUX_INPUT_ONLY`, `MULTIVIEWER`),
/// `useOnScreen`, `useOnAux`.
pub fn preconfig_output(key: &str, prop: &str) -> String {
    format!("DeviceObject/preconfig/control/$output/@items/{key}/@props/{prop}")
}

/// A screen in the working configuration: `enable` and `backgroundLayerType`
/// (`DISABLE` / `LIVE_OR_FRAME` / `ONLY_LIVE` / `ONLY_FRAME`).
pub fn preconfig_screen(n: u8, prop: &str) -> String {
    format!("DeviceObject/preconfig/control/$screen/@items/{n}/@props/{prop}")
}

/// Whether an auxiliary is in the working configuration.
pub fn preconfig_aux_enable(n: u8) -> String {
    format!("DeviceObject/preconfig/control/$auxiliaryScreen/@items/{n}/@props/enable")
}

/// The preconfiguration's status: `hasBeenAppliedOnce`, `applyDone`,
/// `computeDone`, `templateValidity`, `screenValidity`, `auxValidity`.
pub fn preconfig_status(prop: &str) -> String {
    format!("DeviceObject/preconfig/status/@props/{prop}")
}

/// What a resource may be set to: `modeValidity`, `useOnScreenValidity`.
pub fn preconfig_resource_validity(n: u8, prop: &str) -> String {
    format!("DeviceObject/preconfig/status/$resources/@items/{n}/@props/{prop}")
}

/// What an output may be set to: `modeValidity`, `useOnScreenValidity`,
/// `useOnAuxValidity`.
pub fn preconfig_output_validity(key: &str, prop: &str) -> String {
    format!("DeviceObject/preconfig/status/$output/@items/{key}/@props/{prop}")
}

/// What a screen may be set to: `backgroundLayerTypeValidity`,
/// `topLayerValidity`.
pub fn preconfig_screen_validity(n: u8, prop: &str) -> String {
    format!("DeviceObject/preconfig/status/$screen/@items/{n}/@props/{prop}")
}

/// The two states a preconfiguration exists in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreconfigState {
    /// The last computed one, not yet applied.
    New,
    /// The applied one — what the device is running.
    Current,
}

impl PreconfigState {
    fn key(self) -> &'static str {
        match self {
            PreconfigState::New => "NEW",
            PreconfigState::Current => "CURRENT",
        }
    }
}

/// A screen in a computed or applied state: `enable`, `outputCount`,
/// `$output` (the store's `outputList` — a list-valued property is spelled
/// like a collection on the wire, and the device answers under that name
/// whichever way it is asked), `layerCount`, `backgroundLayerType`,
/// `isCoveringEnabled`.
pub fn preconfig_state_screen(state: PreconfigState, n: u8, prop: &str) -> String {
    format!("DeviceObject/preconfig/status/$state/@items/{}/$screen/@items/{n}/@props/{prop}", state.key())
}

/// An auxiliary in a computed or applied state: `mode`, `$output`.
pub fn preconfig_state_aux(state: PreconfigState, n: u8, prop: &str) -> String {
    format!("DeviceObject/preconfig/status/$state/@items/{}/$auxiliaryScreen/@items/{n}/@props/{prop}", state.key())
}

/// An output in a computed or applied state: `mode`, `usedOnScreen`,
/// `usedOnAux`. [`output_role`] is the `CURRENT` case.
pub fn preconfig_state_output(state: PreconfigState, key: &str, prop: &str) -> String {
    format!("DeviceObject/preconfig/status/$state/@items/{}/$output/@items/{key}/@props/{prop}", state.key())
}

// ----------------------------------------------------- configuration slots

/// The two configuration slots on the device, `SLOT_1` and `SLOT_2`.
pub const CONFIG_SLOTS: u8 = 2;

/// A configuration slot's label.
pub fn config_slot_label(slot: u8) -> String {
    format!("DeviceObject/system/configuration/storage/$bank/@items/SLOT_{slot}/control/@props/label")
}

/// A configuration slot's status: `status` (`EMPTY` / `VALID` /
/// `VALID_WARNING` / `INVALID`), `timestamp`, `versionUpdater`, `module`.
pub fn config_slot_status(slot: u8, prop: &str) -> String {
    format!("DeviceObject/system/configuration/storage/$bank/@items/SLOT_{slot}/status/@props/{prop}")
}

/// Erase a configuration slot. A trigger.
pub fn config_slot_delete(slot: u8) -> String {
    format!("DeviceObject/system/configuration/storage/$bank/@items/SLOT_{slot}/delete/cmd/@props/xRequest")
}

/// The backup command: `destination` (`BANK` for a slot, `EXTERNAL` for a
/// file), `slot`, `path`, `label`, and `xRequest` — which takes the **list
/// of modules** to back up (`GENERAL`, `INPUT`, `PRESET`, `SCREEN`,
/// `PRESET_BANK`, `OUTPUT`, `AUDIO`, `MTVW`…), not a flag.
pub fn config_export(prop: &str) -> String {
    format!("DeviceObject/system/configuration/backup/export/cmd/@props/{prop}")
}

/// The backup's progress: `status`, `progress`, `fileName`.
pub fn config_export_status(prop: &str) -> String {
    format!("DeviceObject/system/configuration/backup/export/status/@props/{prop}")
}

/// The first half of a restore — unpack a slot or file: `source` (`BANK` /
/// `EXTERNAL`), `slot`, `path`, and the flag triggers `xRequest`, `xCancel`.
pub fn config_import_extract(prop: &str) -> String {
    format!("DeviceObject/system/configuration/backup/import/extract/cmd/@props/{prop}")
}

/// The unpack's progress: `status` (`DONE` / `DONE_VERSION_WARNING` /
/// errors), `progress`, `module` (what the backup holds).
pub fn config_import_extract_status(prop: &str) -> String {
    format!("DeviceObject/system/configuration/backup/import/extract/status/@props/{prop}")
}

/// The second half of a restore — apply what was unpacked: `stillOption`
/// (`MERGE_AND_REPLACE` / `MERGE_WITHOUT_REPLACE` / `SQUASH`) and `xRequest`,
/// again a list of modules. The device reboots.
pub fn config_import_apply(prop: &str) -> String {
    format!("DeviceObject/system/configuration/backup/import/apply/cmd/@props/{prop}")
}

/// The apply's progress: `status`, `progress`.
pub fn config_import_apply_status(prop: &str) -> String {
    format!("DeviceObject/system/configuration/backup/import/apply/status/@props/{prop}")
}

// --------------------------------------------------------------- streaming

/// Streaming destinations, `1`…`10`; the first four come from the factory.
pub const STREAM_DESTINATIONS: u8 = 10;

/// A destination: `label`, `url`, `key`, and the trigger `xReset`.
pub fn stream_destination(n: u8, prop: &str) -> String {
    format!("DeviceObject/streaming/destinationBank/$slot/@items/{n}/@props/{prop}")
}

/// Whether stream keys survive a power cycle.
pub fn stream_remember_keys() -> String {
    String::from("DeviceObject/streaming/destinationBank/@props/rememberKeys")
}

/// The stream's control: `start` (a flag — true streams, false stops) and
/// `mode` (`SERVER` / `CLIENT`).
pub fn stream_control(prop: &str) -> String {
    format!("DeviceObject/streaming/control/@props/{prop}")
}

/// Which destination to stream to, `1`…`10` as a number.
pub fn stream_target() -> String {
    String::from("DeviceObject/streaming/control/destination/@props/target")
}

/// The stream's picture: `source` (from the status `sourceValidity`),
/// `profile` (`1920_1080_30HZ` … `480_272_30HZ`), `quality` (`LOW` /
/// `MEDIUM` / `HIGH` / `CUSTOM`), `customBitrate` (kbit/s).
pub fn stream_video(prop: &str) -> String {
    format!("DeviceObject/streaming/control/video/@props/{prop}")
}

/// The stream's sound: `mode` (`FOLLOW_CONTENT` / `DIRECT_ROUTING`),
/// `directRoutingSource`, `quality`, `customBitrate`.
pub fn stream_audio(prop: &str) -> String {
    format!("DeviceObject/streaming/control/audio/@props/{prop}")
}

/// The pair the stream carries and its mute: `mute`, `directRoutingPair`,
/// `followContentPair` (`CHANNEL_1_2` … `CHANNEL_7_8`).
pub fn stream_audio_live(prop: &str) -> String {
    format!("DeviceObject/streaming/control/audio/live/@props/{prop}")
}

/// The stream's status: `status` (`NO_REQUEST` / `IN_PROGRESS` / `RUNNING` /
/// errors), `mode`, `urlAndKey`.
pub fn stream_status(prop: &str) -> String {
    format!("DeviceObject/streaming/status/@props/{prop}")
}

/// What the stream is sending: `source`, `sourceValidity`, `profile`,
/// `bitrate`, `hdcpWarning`.
pub fn stream_video_status(prop: &str) -> String {
    format!("DeviceObject/streaming/status/video/@props/{prop}")
}

// ------------------------------------------------------------------- audio

/// Audio on this platform travels as eight-channel **sources** — `IN1`…`IN16`
/// (an input's embedded audio, whichever plug is active), `IN_DANTE_CH1_8`…
/// `IN_DANTE_CH25_32`, `IN_ANALOG_1/2`, `IN_MEDIA_PLAYER`, `CUSTOM_1`…
/// `CUSTOM_10` — and every place it comes out is a **routing point** that
/// carries one source directly or follows something. The audio layer of a
/// preset buffer is the part a show programs: it is saved with the memory
/// and swapped by the take exactly as the picture is.
///
/// The clock: `mode` (`MASTER` / `DANTE`), `masterRate` (`32K` / `44K1` /
/// `48K`), `transitionDelay`.
pub fn audio_control(prop: &str) -> String {
    format!("DeviceObject/audio/control/@props/{prop}")
}

/// The clock as running: `mode`, `rate`, `frequency`, `isDanteRateInvalid`.
pub fn audio_status(prop: &str) -> String {
    format!("DeviceObject/audio/status/@props/{prop}")
}

/// Whether a source key (`IN3`, `IN_DANTE_CH1_8`, `CUSTOM_2`…) exists on this
/// unit.
pub fn audio_source_is_available(key: &str) -> String {
    format!("DeviceObject/audio/$source/@items/{key}/status/@props/isAvailable")
}

/// An audio input (`IN1_SDI_EMBEDDED`, `IN6_RJ45_EMBEDDED`, `IN_ANALOG_1`…):
/// `isAvailable`, `isAudioDetected`, `channelCount`.
pub fn audio_input_status(key: &str, prop: &str) -> String {
    format!("DeviceObject/audio/$input/@items/{key}/status/@props/{prop}")
}

/// Mute one channel of an audio input.
pub fn audio_input_channel_mute(key: &str, channel: u8) -> String {
    format!("DeviceObject/audio/$input/@items/{key}/$channel/@items/{channel}/control/@props/mute")
}

/// Which side of the unit a level meter reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioSide {
    Input,
    Output,
}

impl AudioSide {
    fn list(self) -> &'static str {
        match self {
            AudioSide::Input => "$input",
            AudioSide::Output => "$output",
        }
    }
}

/// The unit reports one level per side, for the key selected here.
pub fn audio_level_select(side: AudioSide) -> String {
    format!("DeviceObject/audio/{}/level/control/@props/select", side.list())
}

/// Ask for a fresh reading. A trigger.
pub fn audio_level_refresh(side: AudioSide) -> String {
    format!("DeviceObject/audio/{}/level/control/@props/xRefresh", side.list())
}

/// The reading.
pub fn audio_level(side: AudioSide) -> String {
    format!("DeviceObject/audio/{}/level/status/@props/level", side.list())
}

/// Mute an audio output as a whole (`VIDEO_OUT_1`…`VIDEO_OUT_6`,
/// `VIDEO_MULTIVIEWER`, `DANTE_CH1_8`…, `ANALOG_1/2`).
pub fn audio_output_mute(key: &str) -> String {
    format!("DeviceObject/audio/$output/@items/{key}/control/@props/mute")
}

/// An audio output's status: `isAvailable`, `source` (what it is carrying).
pub fn audio_output_status(key: &str, prop: &str) -> String {
    format!("DeviceObject/audio/$output/@items/{key}/status/@props/{prop}")
}

/// A line out `1`…`2`: `mode` (`DIRECT_ROUTING` / `FOLLOW_SCREEN`) and
/// `selectedAudioPair`.
pub fn audio_line_out(n: u8, prop: &str) -> String {
    format!("DeviceObject/audio/$lineOut/@items/{n}/control/@props/{prop}")
}

/// The source a line out carries when routed directly.
pub fn audio_line_out_direct(n: u8) -> String {
    format!("DeviceObject/audio/$lineOut/@items/{n}/control/directRouting/@props/source")
}

/// The screen a line out follows.
pub fn audio_line_out_follow(n: u8) -> String {
    format!("DeviceObject/audio/$lineOut/@items/{n}/control/followScreen/@props/screen")
}

/// Mute a destination's audio.
pub fn audio_destination_mute(d: Dest) -> String {
    format!("DeviceObject/audio/{}/control/@props/mute", d.item())
}

/// The channels a custom source may be built from, as the unit lists them.
pub fn audio_custom_channels() -> String {
    String::from("DeviceObject/audio/custom/status/@props/availableChannels")
}

/// A custom source `1`…`10`: `label` and `channelMapping` (eight channel
/// keys, `NONE` where empty).
pub fn audio_custom(n: u8, prop: &str) -> String {
    format!("DeviceObject/audio/custom/$source/@items/CUSTOM_{n}/control/@props/{prop}")
}

/// The Dante card's status: `global`, `type`, `id`, `version`,
/// `ethernetMode`, `hasInitFailed`.
pub fn dante_status(prop: &str) -> String {
    format!("DeviceObject/audio/dante/status/@props/{prop}")
}

/// A Dante output group `1`…`4` (eight channels each): `mode`
/// (`DIRECT_ROUTING` / `FOLLOW_SCREEN`).
pub fn dante_group(n: u8, prop: &str) -> String {
    format!("DeviceObject/audio/dante/$outputGroup/@items/{n}/control/@props/{prop}")
}

/// The source a Dante group carries when routed directly.
pub fn dante_group_direct(n: u8) -> String {
    format!("DeviceObject/audio/dante/$outputGroup/@items/{n}/control/directRouting/@props/source")
}

/// The screen a Dante group follows.
pub fn dante_group_follow(n: u8) -> String {
    format!("DeviceObject/audio/dante/$outputGroup/@items/{n}/control/followScreen/@props/screen")
}

/// A destination's routing point: `mode` — for a screen `DIRECT_ROUTING`,
/// `FOLLOW_LIVE_LAYER_CONTENT` or `FOLLOW_AUDIO_LAYER`; for an auxiliary
/// `DIRECT_ROUTING`, `FOLLOW_CONTENT` or `FOLLOW_AUDIO_LAYER`. The factory
/// default is the audio layer.
pub fn destination_audio_mode(d: Dest) -> String {
    format!("DeviceObject/{}/audio/control/@props/mode", d.item())
}

/// The source a destination carries when routed directly.
pub fn destination_audio_direct(d: Dest) -> String {
    format!("DeviceObject/{}/audio/control/directRouting/@props/source", d.item())
}

/// The live layer whose content a screen follows in
/// `FOLLOW_LIVE_LAYER_CONTENT`.
pub fn screen_audio_follow_layer(screen: u8) -> String {
    format!("DeviceObject/$screen/@items/{screen}/audio/control/followLiveLayer/@props/layer")
}

/// The audio layer of a buffer — the source that takes with the preset.
pub fn audio_layer(d: Dest, buffer: Buffer) -> String {
    format!("DeviceObject/{}/$preset/@items/{}/audio/control/@props/source", d.item(), buffer.key())
}

/// A video output's audio: `mode` (`NONE` / `AUTO` for the screen it shows /
/// `DIRECT_ROUTING`).
pub fn output_audio_mode(key: &str) -> String {
    format!("DeviceObject/$output/@items/{key}/audio/control/@props/mode")
}

/// The source a video output carries when routed directly.
pub fn output_audio_direct(key: &str) -> String {
    format!("DeviceObject/$output/@items/{key}/audio/control/directRouting/@props/source")
}

/// The multiviewer's audio: `mode` (`DIRECT_ROUTING` / `FOLLOW_WIDGET`).
pub fn mvw_audio(prop: &str) -> String {
    format!("DeviceObject/multiviewer/audio/control/@props/{prop}")
}

/// The widget the multiviewer's audio follows.
pub fn mvw_audio_follow_widget() -> String {
    String::from("DeviceObject/multiviewer/audio/control/followWidget/@props/widget")
}

/// The widget that shows VU meters, or `NONE`; from
/// `multiviewer/audio/status/vuMeters/@props/widgetValidity`.
pub fn mvw_audio_vu_widget() -> String {
    String::from("DeviceObject/multiviewer/audio/control/vuMeters/@props/widget")
}

/// What the quick preset does to audio: `PRESET`, `KEEP`, `MUTE` or
/// `FORCE_SOURCE` (with `quickPreset/control/audio/forceSource/@props/source`).
pub fn quick_preset_audio_mode() -> String {
    String::from("DeviceObject/quickPreset/control/audio/@props/mode")
}

// ------------------------------------------------------------ save filters

/// What a bank save of a destination records, set before the save and kept:
/// `categoryFilter` (`SOURCE`, `POS`, `SIZE`, `OPACITY`, `CROPPING`, `MASK`,
/// `BORDER`, `TRANSITIONS`, `EFFECTS`, `FLYING_CURVE`, `TIMING`, `SPEED`,
/// `AUDIO`; an auxiliary has `SOURCE`, `ASPECT`, `TRANSITIONS`, `AUDIO`),
/// and on a screen `layerFilter` (`"1"`…`"8"`), `layerTopFilter`,
/// `layerBackFilter`. A slot's status reports the filter it was saved with.
pub fn save_filter(d: Dest, prop: &str) -> String {
    format!("DeviceObject/{}/control/save/{}/@props/{prop}", d.bank().root(), d.item())
}

/// What a master save records: `screenFilter`, `auxFilter` (which
/// destinations), `screenCategoryFilter`, `auxCategoryFilter`,
/// `screenLayerLiveFilter`, `screenLayerTopFilter`, `screenLayerBackFilter`.
/// Beside [`master_save_mode`] on the same node.
pub fn master_save_filter(prop: &str) -> String {
    format!("DeviceObject/preset/masterBank/control/save/@props/{prop}")
}

/// Rescale a memory's layers to the screen's canvas on load (true), or keep
/// them as saved. The device's own flag, per screen; a master load honours it
/// for each screen it covers. The Web RCS's "Auto Scale" switch sets all four.
pub fn preset_auto_scale(screen: u8) -> String {
    format!("DeviceObject/preset/bank/control/$screen/@items/{screen}/@props/autoScale")
}

/// The multiviewer's own autoscale-on-load flag.
pub fn mvw_load_auto_scale() -> String {
    String::from("DeviceObject/multiviewer/$bank/control/load/@props/autoScale")
}

// -------------------------------------------------------------------- LUTs

/// The two LUT libraries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LutKind {
    /// Colour-space and HDR conversion, described by a from/to pair.
    Conversion,
    /// A correction applied after it, in one colour space.
    Correction,
}

impl LutKind {
    fn node(self) -> &'static str {
        match self {
            LutKind::Conversion => "conversion",
            LutKind::Correction => "correction",
        }
    }
}

/// LUT resources (processors) on the model; each is allocated to one input.
pub const LUT_RESOURCES: u8 = 4;

/// A library slot's control: `label`, or the trigger `xDelete`. A `.cube`
/// file reaches a slot through `lutLibraries/<kind>/import/cmd` from a path
/// on the unit — the Web RCS uploads it — which this crate does not spell.
pub fn lut_bank(kind: LutKind, slot: u8, prop: &str) -> String {
    format!("DeviceObject/lutLibraries/{}/$bank/@items/{slot}/control/@props/{prop}", kind.node())
}

/// A library slot's status: `isValid`, `fileName`, `isUsed`, and for a
/// conversion LUT `fromColorSpace`, `fromHdrType`, `fromHdrNitLevel`,
/// `toColorSpace`, `toHdrType`, `toHdrNitLevel`; for a correction LUT
/// `colorSpace`. A Pulse 4K on 3.3.10 carries four slots per library; the
/// simulator answers twenty.
pub fn lut_bank_status(kind: LutKind, slot: u8, prop: &str) -> String {
    format!("DeviceObject/lutLibraries/{}/$bank/@items/{slot}/status/@props/{prop}", kind.node())
}

/// Which input a LUT resource serves (`INPUT_<n>`). Only an input with one
/// can run a LUT on its plug (`plug_status(…, "canUseLutProcessing")`).
pub fn lut_resource(n: u8) -> String {
    format!("DeviceObject/$inputLutResource/@items/{n}/control/@props/useOnInput")
}

/// A plug's conversion LUT: `mode` (`AUTO` / `CUSTOM`) and `source` (a slot
/// number as a string, or `NONE`), from the status `sourceValidity`.
pub fn plug_conversion_lut(n: u8, plug: u8, prop: &str) -> String {
    format!("DeviceObject/$input/@items/INPUT_{n}/$plug/@items/{plug}/control/conversionLut/@props/{prop}")
}

/// The plug's conversion LUT as running: `isEnabled`, `state`, `source`,
/// `sourceValidity`.
pub fn plug_conversion_lut_status(n: u8, plug: u8, prop: &str) -> String {
    format!("DeviceObject/$input/@items/INPUT_{n}/$plug/@items/{plug}/status/conversionLut/@props/{prop}")
}

/// A plug's correction LUT: `mode` (`MANUAL` / `AUTO`) and `source`. Under
/// `settings`, unlike the conversion one.
pub fn plug_correction_lut(n: u8, plug: u8, prop: &str) -> String {
    format!("DeviceObject/$input/@items/INPUT_{n}/$plug/@items/{plug}/settings/correctionLut/control/@props/{prop}")
}

/// The plug's correction LUT as running.
pub fn plug_correction_lut_status(n: u8, plug: u8, prop: &str) -> String {
    format!("DeviceObject/$input/@items/INPUT_{n}/$plug/@items/{plug}/settings/correctionLut/status/@props/{prop}")
}

/// An output's conversion LUT: `mode`, `source`.
pub fn output_conversion_lut(key: &str, prop: &str) -> String {
    format!("DeviceObject/$output/@items/{key}/conversionLut/control/@props/{prop}")
}

/// The output's conversion LUT as running.
pub fn output_conversion_lut_status(key: &str, prop: &str) -> String {
    format!("DeviceObject/$output/@items/{key}/conversionLut/status/@props/{prop}")
}

/// An output's correction LUT: `mode`, `source`. Under `settings`.
pub fn output_correction_lut(key: &str, prop: &str) -> String {
    format!("DeviceObject/$output/@items/{key}/settings/correctionLut/control/@props/{prop}")
}

/// The output's correction LUT as running.
pub fn output_correction_lut_status(key: &str, prop: &str) -> String {
    format!("DeviceObject/$output/@items/{key}/settings/correctionLut/status/@props/{prop}")
}

// --------------------------------------------------------------- soft edge

/// Soft edge on one gap of a grid canvas, by the tail of its path under
/// `softedge`: `curve/@props/{enable, type (GAMMA / BEZIER), gamma}`,
/// `curve/point1/@props/{posH, posV}`, `curve/point2/…`,
/// `blackLevel/@props/{offset, red, green, blue}`. Applied with the grid's
/// `xSoftedgeUpdate` ([`screen_grid`]). Only an Eikos 4K blends; the other
/// models carry the settings and do nothing with them.
pub fn screen_grid_softedge(screen: u8, dim: GridDim, i: u8, tail: &str) -> String {
    format!("DeviceObject/$screen/@items/{screen}/canvas/grid/${}Spacing/@items/{i}/softedge/{tail}", dim.word())
}

/// A subscription prefix that covers every destination's transition control
/// and status — both lists, since the pushes are filtered by prefix.
pub const SUB_TRANSITIONS: &str = "DeviceObject/transition";

/// Subscription prefixes for the multiviewer, the timers, the still library
/// and the outputs.
pub const SUB_MULTIVIEWER: &str = "DeviceObject/multiviewer";
pub const SUB_TIMERS: &str = "DeviceObject/$timer";
pub const SUB_STILLS: &str = "DeviceObject/stillLibrary";
pub const SUB_OUTPUTS: &str = "DeviceObject/$output";

/// Subscription prefixes for audio, the preconfiguration, every screen (wide),
/// streaming and the custom formats.
pub const SUB_AUDIO: &str = "DeviceObject/audio";
pub const SUB_PRECONFIG: &str = "DeviceObject/preconfig";
pub const SUB_SCREENS: &str = "DeviceObject/$screen";
pub const SUB_STREAMING: &str = "DeviceObject/streaming";
pub const SUB_CUSTOM_FORMATS: &str = "DeviceObject/customFormats";

/// A subscription prefix covering the quick preset's switch and status.
pub const SUB_QUICK_PRESET: &str = "DeviceObject/quickPreset";

/// A subscription prefix covering the on-air lists.
pub const SUB_TALLIES: &str = "DeviceObject/tallies";

/// A subscription prefix covering one destination whole — its buffers, their
/// layers, its freeze and label. Wide, so subscribe to the one being edited.
pub fn sub_destination(d: Dest) -> String {
    format!("DeviceObject/{}", d.item())
}

/// A subscription prefix covering one input: plug, freeze, black, LED.
pub fn sub_input(n: u8) -> String {
    format!("DeviceObject/$input/@items/INPUT_{n}")
}
