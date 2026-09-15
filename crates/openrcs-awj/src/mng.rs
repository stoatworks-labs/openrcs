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

/// A subscription prefix that covers every destination's transition control
/// and status — both lists, since the pushes are filtered by prefix.
pub const SUB_TRANSITIONS: &str = "DeviceObject/transition";

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
