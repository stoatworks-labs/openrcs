//! Facts about the Midra 4K / Alta 4K object model that must not regress.
//!
//! Every path pinned here was answered by a Pulse 4K on firmware 3.3.10 on
//! 2026-09-12, and by the vendor's Midra 4K (3.2.29) and Alta 4K (1.3.7)
//! simulators — except the block marked "from the store", which is spelled
//! from that same unit's store dump and has so far been answered over AWJ by
//! the simulators only. The negative controls at the bottom are what the
//! device said to the LivePremier spellings: `E12`, every one.

use openrcs_awj::mng::{self, Bank, Dest, TallyBus};
use openrcs_awj::{paths, Buffer, Dialect, Preset, Transition};

#[test]
fn destinations_are_numbered_in_two_lists() {
    // Screen 1 and auxiliary 1 are both keyed `1`; the kind is the list.
    assert_eq!(
        mng::label(Dest::Screen(1)),
        "DeviceObject/$screen/@items/1/control/@props/label"
    );
    assert_eq!(
        mng::label(Dest::Aux(1)),
        "DeviceObject/$auxiliaryScreen/@items/1/control/@props/label"
    );
    assert_eq!(Dest::Screen(3).id(), "S3");
    assert_eq!(Dest::Aux(2).id(), "A2");
    assert_eq!(Dest::parse("S3"), Some(Dest::Screen(3)));
    assert_eq!(Dest::parse("A2"), Some(Dest::Aux(2)));
    assert_eq!(Dest::parse("X1"), None);
    assert_eq!(Dest::parse("S"), None);
    assert_eq!(Dest::ALL.len(), 8);
}

#[test]
fn takes_live_under_a_transition_node_with_one_take_time() {
    assert_eq!(
        mng::take(Dest::Screen(1)),
        "DeviceObject/transition/$screen/@items/1/control/@props/xTake"
    );
    assert_eq!(
        mng::cut(Dest::Aux(2)),
        "DeviceObject/transition/$auxiliaryScreen/@items/2/control/@props/xCut"
    );
    assert_eq!(
        mng::take_time(Dest::Screen(2)),
        "DeviceObject/transition/$screen/@items/2/control/@props/takeTime"
    );
    assert_eq!(
        mng::transition(Dest::Screen(1)),
        "DeviceObject/transition/$screen/@items/1/status/@props/transition"
    );
    assert_eq!(
        mng::tbar_position(Dest::Aux(1)),
        "DeviceObject/transition/$auxiliaryScreen/@items/1/status/@props/tbarPosition"
    );
    assert_eq!(
        mng::step_back(Dest::Screen(1)),
        "DeviceObject/transition/$screen/@items/1/control/@props/xStepBack"
    );
    assert_eq!(
        mng::take_abort(Dest::Screen(1)),
        "DeviceObject/transition/$screen/@items/1/control/@props/xTakeAbort"
    );
    assert_eq!(
        mng::copy_program_to_preview(Dest::Screen(1)),
        "DeviceObject/transition/$screen/@items/1/control/@props/xCopyProgramToPreview"
    );
    // The subscription prefix the surface writes covers both lists.
    assert!(mng::take(Dest::Screen(4)).starts_with(mng::SUB_TRANSITIONS));
    assert!(mng::transition(Dest::Aux(4)).starts_with(mng::SUB_TRANSITIONS));
}

#[test]
fn the_tbar_is_driven_on_control_and_read_on_status() {
    assert_eq!(
        mng::tbar_control(Dest::Screen(1)),
        "DeviceObject/transition/$screen/@items/1/control/@props/tbarPosition"
    );
    assert_eq!(
        mng::preset_toggle(Dest::Aux(1)),
        "DeviceObject/transition/$auxiliaryScreen/@items/1/control/@props/enablePresetToggle"
    );
}

#[test]
fn take_many_names_destinations_a_third_way() {
    // Not `S1`, not `1`: the list the device's own TAKE ALL writes.
    assert_eq!(
        mng::take_many(),
        "DeviceObject/transition/control/@props/xTakeMany"
    );
    assert_eq!(Dest::Screen(1).take_many_id(), "SCREEN_1");
    assert_eq!(Dest::Aux(4).take_many_id(), "AUX_4");
}

#[test]
fn a_master_save_records_what_its_mode_says_and_writes_bank_slots() {
    assert_eq!(
        mng::master_save_mode(),
        "DeviceObject/preset/masterBank/control/save/@props/mode"
    );
    // The slot each destination's buffer lands in on a SAVE_FROM_* save —
    // 1 for all of them by default, which is the trap.
    assert_eq!(
        mng::master_save_bank_slot(Dest::Screen(2)),
        "DeviceObject/preset/masterBank/control/save/$screen/@items/2/@props/bankSlot"
    );
    assert_eq!(
        mng::master_save_bank_slot(Dest::Aux(1)),
        "DeviceObject/preset/masterBank/control/save/$auxiliaryScreen/@items/1/@props/bankSlot"
    );
}

#[test]
fn layer_properties_hang_off_the_buffer_and_the_canvas_off_the_screen() {
    assert_eq!(
        mng::layer_pos_h(1, Buffer::Up, 2),
        "DeviceObject/$screen/@items/1/$preset/@items/UP/$liveLayer/@items/2/position/@props/posH"
    );
    assert_eq!(
        mng::layer_size_v(2, Buffer::Down, 1),
        "DeviceObject/$screen/@items/2/$preset/@items/DOWN/$liveLayer/@items/1/size/@props/sizeV"
    );
    assert_eq!(
        mng::layer_opacity(1, Buffer::Up, 1),
        "DeviceObject/$screen/@items/1/$preset/@items/UP/$liveLayer/@items/1/opacity/@props/opacity"
    );
    assert_eq!(
        mng::layer_state(1, Buffer::Up, 1),
        "DeviceObject/$screen/@items/1/$preset/@items/UP/$liveLayer/@items/1/status/@props/state"
    );
    // The generic builder spells the deeper leaves the same way.
    assert_eq!(
        mng::layer_prop(1, Buffer::Up, 1, "border/edge/color/@props/red"),
        "DeviceObject/$screen/@items/1/$preset/@items/UP/$liveLayer/@items/1/border/edge/color/@props/red"
    );
    assert_eq!(
        mng::canvas_width(1),
        "DeviceObject/$screen/@items/1/canvas/status/size/@props/sizeH"
    );
}

// ---- from the store: spelled from the Pulse 4K's dump, answered by the simulators

#[test]
fn freeze_and_faders_are_per_screen_not_per_buffer() {
    assert_eq!(
        mng::freeze(Dest::Screen(1)),
        "DeviceObject/$screen/@items/1/control/@props/freeze"
    );
    assert_eq!(
        mng::freeze(Dest::Aux(2)),
        "DeviceObject/$auxiliaryScreen/@items/2/control/@props/freeze"
    );
    assert_eq!(
        mng::layer_freeze(1, 3),
        "DeviceObject/$screen/@items/1/$liveLayer/@items/3/control/@props/freeze"
    );
    assert_eq!(
        mng::layer_fader(1, 1),
        "DeviceObject/$screen/@items/1/$liveLayer/@items/1/fader/@props/opacity"
    );
    assert_eq!(
        mng::layer_fade_out(1, 1),
        "DeviceObject/$screen/@items/1/$liveLayer/@items/1/fader/@props/xFadeOut"
    );
}

#[test]
fn inputs_are_keyed_input_n_and_labels_live_on_plugs() {
    assert_eq!(mng::input_key(7), "INPUT_7");
    assert_eq!(
        mng::input_is_available(1),
        "DeviceObject/$input/@items/INPUT_1/status/@props/isAvailable"
    );
    assert_eq!(
        mng::input_led(16),
        "DeviceObject/$input/@items/INPUT_16/status/@props/ledColor"
    );
    assert_eq!(
        mng::input_plug(1),
        "DeviceObject/$input/@items/INPUT_1/control/@props/plug"
    );
    assert_eq!(
        mng::input_freeze(1),
        "DeviceObject/$input/@items/INPUT_1/control/@props/freeze"
    );
    assert_eq!(
        mng::plug_label(1, 1),
        "DeviceObject/$input/@items/INPUT_1/$plug/@items/1/control/@props/label"
    );
    assert_eq!(
        mng::plug_format_name(3, 1),
        "DeviceObject/$input/@items/INPUT_3/$plug/@items/1/status/signal/@props/formatName"
    );
}

#[test]
fn the_device_keeps_four_input_tallies() {
    assert_eq!(
        mng::tally_inputs(TallyBus::ScreenProgram),
        "DeviceObject/tallies/inputs/@props/usedOnScreenPgm"
    );
    assert_eq!(
        mng::tally_inputs(TallyBus::AuxPreview),
        "DeviceObject/tallies/inputs/@props/usedOnAuxPrw"
    );
    assert_eq!(mng::SUB_TALLIES, "DeviceObject/tallies");
    assert_eq!(mng::sub_destination(Dest::Aux(1)), "DeviceObject/$auxiliaryScreen/@items/1");
    assert_eq!(mng::sub_input(2), "DeviceObject/$input/@items/INPUT_2");
}

#[test]
fn in_service_comes_from_the_applied_preconfig() {
    assert_eq!(
        mng::screen_enabled(1),
        "DeviceObject/preconfig/status/$state/@items/CURRENT/$screen/@items/1/@props/enable"
    );
    assert_eq!(
        mng::aux_mode(1),
        "DeviceObject/preconfig/status/$state/@items/CURRENT/$auxiliaryScreen/@items/1/@props/mode"
    );
    assert_eq!(
        mng::screen_layer_count(2),
        "DeviceObject/preconfig/status/$state/@items/CURRENT/$screen/@items/2/@props/layerCount"
    );
    assert_eq!(
        mng::layer_mode(1, 1),
        "DeviceObject/preconfig/status/$state/@items/CURRENT/$screen/@items/1/$liveLayer/@items/1/@props/mode"
    );
}

#[test]
fn banks_are_three_and_slot_metadata_is_under_slot_not_bank() {
    assert_eq!(
        mng::preset_is_valid(Bank::Screen, 5),
        "DeviceObject/preset/bank/$slot/@items/5/status/@props/isValid"
    );
    assert_eq!(
        mng::preset_label(Bank::Aux, 7),
        "DeviceObject/preset/auxBank/$slot/@items/7/control/@props/label"
    );
    assert_eq!(
        mng::preset_delete(Bank::Master, 1),
        "DeviceObject/preset/masterBank/$slot/@items/1/control/@props/xDelete"
    );
    assert_eq!(Bank::Screen.slots(), 200);
    assert_eq!(Bank::Aux.slots(), 200);
    assert_eq!(Bank::Master.slots(), 50);
}

#[test]
fn a_recall_is_slot_then_destination_then_target_and_a_save_the_reverse() {
    assert_eq!(
        mng::load_preset(5, Dest::Screen(1), Preset::Preview),
        "DeviceObject/preset/bank/control/load/$slot/@items/5/$screen/@items/1/$preset/@items/PREVIEW/@props/xRequest"
    );
    // An auxiliary recalls from its own bank; the destination picks it.
    assert_eq!(
        mng::load_preset(7, Dest::Aux(1), Preset::Program),
        "DeviceObject/preset/auxBank/control/load/$slot/@items/7/$auxiliaryScreen/@items/1/$preset/@items/PROGRAM/@props/xRequest"
    );
    assert_eq!(
        mng::save_preset(5, Dest::Screen(1), Preset::Program),
        "DeviceObject/preset/bank/control/save/$screen/@items/1/$preset/@items/PROGRAM/$slot/@items/5/@props/xRequest"
    );
    assert_eq!(
        mng::load_master_preset(1, Preset::Preview),
        "DeviceObject/preset/masterBank/control/load/$slot/@items/1/$preset/@items/PREVIEW/@props/xRequest"
    );
    assert_eq!(
        mng::save_master_preset(1),
        "DeviceObject/preset/masterBank/control/save/$slot/@items/1/@props/xRequest"
    );
    assert_eq!(Dest::Screen(1).bank(), Bank::Screen);
    assert_eq!(Dest::Aux(1).bank(), Bank::Aux);
}

#[test]
fn which_memory_a_buffer_holds_is_on_the_destination() {
    assert_eq!(
        mng::buffer_memory_id(Dest::Screen(1), Buffer::Up),
        "DeviceObject/$screen/@items/1/$preset/@items/UP/status/@props/memoryId"
    );
    assert_eq!(
        mng::buffer_is_modified(Dest::Aux(2), Buffer::Down),
        "DeviceObject/$auxiliaryScreen/@items/2/$preset/@items/DOWN/status/@props/isModified"
    );
}

#[test]
fn layers_are_live_layers_and_an_aux_has_a_background_instead() {
    assert_eq!(
        mng::layer_source(1, Buffer::Up, 1),
        "DeviceObject/$screen/@items/1/$preset/@items/UP/$liveLayer/@items/1/source/@props/input"
    );
    assert_eq!(
        mng::aux_source(1, Buffer::Down),
        "DeviceObject/$auxiliaryScreen/@items/1/$preset/@items/DOWN/background/source/@props/content"
    );
}

#[test]
fn the_buffer_on_air_is_named_by_the_transition_suffix() {
    // The vendor's own rule: UP is program for the three `…UP` states.
    for (s, program) in [
        ("AT_UP", Buffer::Up),
        ("EFFECT_FROM_UP", Buffer::Up),
        ("COPY_FROM_UP", Buffer::Up),
        ("AT_DOWN", Buffer::Down),
        ("EFFECT_FROM_DOWN", Buffer::Down),
        ("COPY_FROM_DOWN", Buffer::Down),
    ] {
        let t = Transition::parse(s).unwrap_or_else(|| panic!("{s} should parse"));
        assert_eq!(Buffer::program(t), program, "{s}");
        assert_ne!(Buffer::preview(t), program, "{s}");
        assert_eq!(Buffer::for_preset(t, Preset::Program), program, "{s}");
        assert_eq!(Buffer::for_preset(t, Preset::Preview), Buffer::preview(t), "{s}");
    }
    assert_eq!(Buffer::Up.key(), "UP");
    assert_eq!(Buffer::Down.key(), "DOWN");
}

#[test]
fn each_dialect_has_an_identity_path_the_other_lacks() {
    assert_eq!(
        Dialect::Mng.identity_path(),
        "DeviceObject/system/@props/dev"
    );
    assert_eq!(
        Dialect::LivePremier.identity_path(),
        "DeviceObject/system/$device/@items/1/@props/dev"
    );
    assert_ne!(
        Dialect::Mng.identity_path(),
        Dialect::LivePremier.identity_path()
    );
    assert_eq!(
        mng::platform_label(),
        "DeviceObject/system/@props/platformLabel"
    );
    assert_eq!(
        mng::device_version(),
        "DeviceObject/system/version/@props/updater"
    );
}

#[test]
fn the_two_object_models_share_no_destination_path() {
    // Negative controls, as the Pulse 4K answered them: every LivePremier
    // spelling was `E12` there, so no path may be built for one model and
    // sent to the other by accident.
    let lp = [
        paths::screen_take(1),
        paths::screen_label(1),
        paths::load_screen_preset(1, 1, Preset::Preview),
        paths::preset_is_valid(1),
    ];
    let m = [
        mng::take(Dest::Screen(1)),
        mng::label(Dest::Screen(1)),
        mng::load_preset(1, Dest::Screen(1), Preset::Preview),
        mng::preset_is_valid(Bank::Screen, 1),
    ];
    for a in &lp {
        for b in &m {
            assert_ne!(a, b);
        }
        // `S1` is a LivePremier key and `presetBank` a LivePremier bank; the
        // other model carries neither.
        assert!(a.contains("/S1/") || a.contains("presetBank"), "{a}");
    }
    for b in &m {
        assert!(!b.contains("/S1/"), "{b}");
        assert!(!b.contains("$screenAuxGroup"), "{b}");
        assert!(!b.contains("presetBank"), "{b}");
    }
}
