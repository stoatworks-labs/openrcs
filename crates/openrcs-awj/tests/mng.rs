//! Facts about the Midra 4K / Alta 4K object model that must not regress.
//!
//! Every path pinned here was answered by a Pulse 4K on firmware 3.3.10 on
//! 2026-09-12, and by the vendor's Midra 4K (3.2.29) and Alta 4K (1.3.7)
//! simulators. The negative controls at the bottom are what the same device
//! said to the LivePremier spellings: `E12`, every one.

use openrcs_awj::mng::{self, Bank, Dest};
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
