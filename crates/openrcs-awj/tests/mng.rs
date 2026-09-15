//! Facts about the Midra 4K / Alta 4K object model that must not regress.
//!
//! Every path pinned here was answered by a Pulse 4K on firmware 3.3.10 on
//! 2026-09-12, and by the vendor's Midra 4K (3.2.29) and Alta 4K (1.3.7)
//! simulators — except the block marked "from the store", which is spelled
//! from that same unit's store dump and has so far been answered over AWJ by
//! the simulators only. The negative controls at the bottom are what the
//! device said to the LivePremier spellings: `E12`, every one.

use openrcs_awj::mng::{self, Bank, Dest, FrameList, OutputRole, TallyBus};
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
fn a_preset_has_a_background_and_a_top_frame_beside_its_live_layers() {
    assert_eq!(
        mng::background_prop(1, Buffer::Up, "source/@props/set"),
        "DeviceObject/$screen/@items/1/$preset/@items/UP/background/source/@props/set"
    );
    assert_eq!(
        mng::top_prop(2, Buffer::Down, "source/@props/frame"),
        "DeviceObject/$screen/@items/2/$preset/@items/DOWN/top/source/@props/frame"
    );
    assert_eq!(
        mng::background_set_content(1, 3),
        "DeviceObject/$screen/@items/1/$backgroundSet/@items/3/control/@props/singleContent"
    );
    assert_eq!(
        mng::frame_is_valid(1, FrameList::Top, 2),
        "DeviceObject/$screen/@items/1/$topFrame/@items/2/status/@props/isValid"
    );
    assert_eq!(
        mng::frame_library_slot(1, FrameList::Back, 1),
        "DeviceObject/$screen/@items/1/$backFrame/@items/1/control/@props/librarySlot"
    );
    assert_eq!(FrameList::Back.snapshot_kind(), "back");
}

#[test]
fn snapshots_are_served_by_the_unit_itself() {
    assert_eq!(
        mng::input_snapshot_enable(3),
        "DeviceObject/$input/@items/INPUT_3/snapshot/@props/enable"
    );
    assert_eq!(mng::snapshot_http_path("inputs", 3), "/api/device/snapshots/inputs/3");
    assert_eq!(mng::snapshot_http_path("screens/1/top", 2), "/api/device/snapshots/screens/1/top/2");
}

#[test]
fn the_quick_preset_is_one_switch_with_a_mode_and_a_filter() {
    assert_eq!(mng::quick_preset_enable(), "DeviceObject/quickPreset/control/@props/enable");
    assert_eq!(mng::quick_preset_mode(), "DeviceObject/quickPreset/control/@props/mode");
    assert_eq!(mng::quick_preset_is_enabled(), "DeviceObject/quickPreset/status/@props/isEnabled");
    assert_eq!(
        mng::quick_preset_filter(Dest::Aux(2)),
        "DeviceObject/quickPreset/control/filter/$auxiliaryScreen/@items/2/@props/enable"
    );
    assert_eq!(
        mng::quick_preset_on(Dest::Screen(1)),
        "DeviceObject/quickPreset/status/$screen/@items/1/@props/isEnabled"
    );
    assert_eq!(mng::SUB_QUICK_PRESET, "DeviceObject/quickPreset");
}

#[test]
fn system_health_and_network_are_read_off_system() {
    assert_eq!(mng::serial_number(), "DeviceObject/system/serial/@props/serialNumber");
    assert_eq!(
        mng::sensor("CM_INTAKE", "temperature"),
        "DeviceObject/system/temperature/$sensor/@items/CM_INTAKE/@props/temperature"
    );
    assert_eq!(mng::case_fan(1, "speed"), "DeviceObject/system/fan/$case/@items/1/@props/speed");
    assert_eq!(mng::front_panel_lock(), "DeviceObject/system/frontPanel/@props/lock");
    assert_eq!(mng::front_panel("lcdBrightness"), "DeviceObject/system/frontPanel/@props/lcdBrightness");
    assert_eq!(mng::ipv4_status("ip"), "DeviceObject/system/network/ipv4/status/@props/ip");
    assert_eq!(mng::reboot(), "DeviceObject/system/shutdown/@props/xReboot");
    assert_eq!(mng::SENSORS.len(), 14);
}

#[test]
fn the_multiviewer_is_twenty_widgets_and_twenty_memories_on_mtvw() {
    assert_eq!(mng::MULTIVIEWER_OUTPUT, "MTVW");
    assert_eq!(
        mng::mvw_widget(3, "source"),
        "DeviceObject/multiviewer/$widget/@items/3/control/@props/source"
    );
    assert_eq!(
        mng::mvw_widget_status(1, "isEnabled"),
        "DeviceObject/multiviewer/$widget/@items/1/status/@props/isEnabled"
    );
    assert_eq!(mng::mvw_source_validity(), "DeviceObject/multiviewer/status/@props/sourceValidity");
    assert_eq!(
        mng::mvw_load(7),
        "DeviceObject/multiviewer/$bank/control/load/$slot/@items/7/@props/xRequest"
    );
    assert_eq!(
        mng::mvw_preset_label(20),
        "DeviceObject/multiviewer/$bank/@items/20/control/@props/label"
    );
    assert_eq!(mng::timer(2, "xStart"), "DeviceObject/$timer/@items/TIMER_2/control/@props/xStart");
    assert_eq!(mng::timer_state(1), "DeviceObject/$timer/@items/TIMER_1/status/@props/state");
}

#[test]
fn the_still_library_has_fifty_slots_and_a_capture_command() {
    assert_eq!(
        mng::still_status(50, "fileName"),
        "DeviceObject/stillLibrary/$bank/@items/50/status/@props/fileName"
    );
    assert_eq!(mng::still_delete(1), "DeviceObject/stillLibrary/$bank/@items/1/control/@props/xDelete");
    assert_eq!(mng::capture_cmd("xRequest"), "DeviceObject/stillLibrary/capture/cmd/@props/xRequest");
    assert_eq!(mng::capture_status("status"), "DeviceObject/stillLibrary/capture/status/@props/status");
}

#[test]
fn outputs_are_six_and_the_multiviewers_and_a_role_picks_the_format_node() {
    assert_eq!(mng::OUTPUTS.len(), 7);
    assert_eq!(
        mng::output_role("MTVW"),
        "DeviceObject/preconfig/status/$state/@items/CURRENT/$output/@items/MTVW/@props/mode"
    );
    assert_eq!(OutputRole::parse("SCREEN_FORMAT"), Some(OutputRole::Screen));
    assert_eq!(OutputRole::parse("AUX_INPUT_ONLY"), Some(OutputRole::Auxiliary));
    assert_eq!(OutputRole::parse("MULTIVIEWER"), Some(OutputRole::Multiviewer));
    assert_eq!(OutputRole::parse("DISABLE"), None);
    assert_eq!(
        mng::output_format("1", OutputRole::Screen),
        "DeviceObject/$output/@items/1/format/screen/control/@props/format"
    );
    assert_eq!(
        mng::output_format_update("MTVW", OutputRole::Multiviewer),
        "DeviceObject/$output/@items/MTVW/format/multiviewer/control/@props/xUpdate"
    );
    assert_eq!(mng::output_status("2", "rate"), "DeviceObject/$output/@items/2/status/@props/rate");
    assert_eq!(mng::output_setting("1", "gamma"), "DeviceObject/$output/@items/1/settings/@props/gamma");
    assert_eq!(mng::output_pattern("1", "type"), "DeviceObject/$output/@items/1/pattern/control/@props/type");
    assert_eq!(
        mng::output_plug_status("1", 1, "plugStatus"),
        "DeviceObject/$output/@items/1/$plug/@items/1/status/@props/plugStatus"
    );
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

#[test]
fn input_plugs_carry_the_settings_the_keyer_and_the_edid() {
    // Spelled from the Pulse 4K store dump and answered by both simulators
    // (2026-09-15): the settings hang off the plug, the keyer under them.
    assert_eq!(mng::plug_control(1, 1, "enableHdcp"), "DeviceObject/$input/@items/INPUT_1/$plug/@items/1/control/@props/enableHdcp");
    assert_eq!(mng::plug_status(1, 1, "hdcpValidity"), "DeviceObject/$input/@items/INPUT_1/$plug/@items/1/status/@props/hdcpValidity");
    assert_eq!(mng::plug_signal(1, 1, "formatWidth"), "DeviceObject/$input/@items/INPUT_1/$plug/@items/1/status/signal/@props/formatWidth");
    assert_eq!(mng::plug_setting(1, 1, "color/@props/brightness"), "DeviceObject/$input/@items/INPUT_1/$plug/@items/1/settings/color/@props/brightness");
    assert_eq!(mng::plug_keying_mode(1, 1), "DeviceObject/$input/@items/INPUT_1/$plug/@items/1/settings/keying/control/@props/mode");
    assert_eq!(mng::plug_setting(1, 1, "keying/cutNFill/status/@props/source"), "DeviceObject/$input/@items/INPUT_1/$plug/@items/1/settings/keying/cutNFill/status/@props/source");
    assert_eq!(mng::input_keying_is_available(1), "DeviceObject/$input/@items/INPUT_1/status/keying/@props/isAvailable");
    assert_eq!(mng::input_cut_fill_is_available(1), "DeviceObject/$input/@items/INPUT_1/status/keying/cutNFill/@props/isAvailable");
    assert_eq!(mng::plug_hdr(1, 1, "mode"), "DeviceObject/$input/@items/INPUT_1/$plug/@items/1/control/hdr/@props/mode");
    assert_eq!(mng::plug_edid_cmd(1, 1), "DeviceObject/$input/@items/INPUT_1/$plug/@items/1/edid/cmd/@props/data");
    assert_eq!(mng::plug_edid_extension(1, 1, 1, "extensionType"), "DeviceObject/$input/@items/INPUT_1/$plug/@items/1/edid/status/$extension/@items/BLOCK_1/@props/extensionType");
    // The library: numbered user slots and named factory entries in one collection.
    assert_eq!(mng::edid_bank_status("DEFAULT_HDMI_2_0", "isProtected"), "DeviceObject/system/edid/$bank/@items/DEFAULT_HDMI_2_0/status/@props/isProtected");
    assert_eq!(mng::edid_save(3), "DeviceObject/system/edid/save/$bank/@items/3/@props/xRequest");
    assert_eq!(mng::edid_edit("data"), "DeviceObject/system/edid/edit/control/@props/data");
    assert_eq!(mng::EDID_SLOTS, 64);
}

#[test]
fn outputs_have_a_canvas_hdr_a_plug_and_custom_formats() {
    assert_eq!(mng::output_aoi("1", "xUpdate"), "DeviceObject/$output/@items/1/canvas/aoi/@props/xUpdate");
    // Pitch was answered by the real Pulse 4K in the field-test sweep.
    assert_eq!(mng::output_pitch("2", "pitchRatioH"), "DeviceObject/$output/@items/2/canvas/pitch/@props/pitchRatioH");
    assert_eq!(mng::output_canvas_status("1", "aoiWidth"), "DeviceObject/$output/@items/1/canvas/status/@props/aoiWidth");
    assert_eq!(mng::output_hdr("1", "nitLevel"), "DeviceObject/$output/@items/1/hdr/control/@props/nitLevel");
    assert_eq!(mng::output_plug_control("1", 1, "enableHdcp"), "DeviceObject/$output/@items/1/$plug/@items/1/control/@props/enableHdcp");
    assert_eq!(mng::output_plug_audio_mode("1", 1), "DeviceObject/$output/@items/1/$plug/@items/1/audio/control/@props/mode");
    assert_eq!(mng::output_plug_edid("1", 1, "data"), "DeviceObject/$output/@items/1/$plug/@items/1/edid/status/@props/data");
    assert_eq!(mng::custom_format_setting("fullCvtRate"), "DeviceObject/customFormats/create/settings/@props/fullCvtRate");
    assert_eq!(mng::custom_format_control("xCheck"), "DeviceObject/customFormats/create/control/@props/xCheck");
    assert_eq!(mng::custom_format_save(4), "DeviceObject/customFormats/create/save/$bank/@items/4/@props/xRequest");
    assert_eq!(mng::custom_format_slot_status(16, "isValid"), "DeviceObject/customFormats/$bank/@items/16/status/@props/isValid");
    assert_eq!(mng::CUSTOM_FORMATS, 16);
}

#[test]
fn a_screen_is_a_grid_or_a_free_canvas_with_its_own_pattern() {
    assert_eq!(mng::screen_mode(1), "DeviceObject/$screen/@items/1/control/@props/mode");
    assert_eq!(mng::screen_grid(1, "columnQty"), "DeviceObject/$screen/@items/1/canvas/grid/control/@props/columnQty");
    assert_eq!(mng::screen_grid_output(1, "MTVW", "row"), "DeviceObject/$screen/@items/1/canvas/grid/$output/@items/MTVW/control/@props/row");
    assert_eq!(mng::screen_grid_spacing(1, mng::GridDim::Column, 2), "DeviceObject/$screen/@items/1/canvas/grid/$columnSpacing/@items/2/control/@props/size");
    assert_eq!(mng::screen_grid_spacing(1, mng::GridDim::Row, 1), "DeviceObject/$screen/@items/1/canvas/grid/$rowSpacing/@items/1/control/@props/size");
    assert_eq!(mng::screen_free_size(1, "sizeH"), "DeviceObject/$screen/@items/1/canvas/free/control/size/@props/sizeH");
    // Free placement is by top-left corner — `left`/`top`, not `posH`/`posV`
    // (that spelling answered E12 on the simulator).
    assert_eq!(mng::screen_free_output(1, "1", "left"), "DeviceObject/$screen/@items/1/canvas/free/control/$output/@items/1/@props/left");
    assert_eq!(mng::screen_pattern(2, "inhibit"), "DeviceObject/$screen/@items/2/pattern/control/@props/inhibit");
    assert_eq!(mng::screen_canvas_has_overlap(1), "DeviceObject/$screen/@items/1/canvas/status/@props/hasOverlapWarning");
}

#[test]
fn the_preconfig_is_staged_computed_and_applied() {
    use mng::PreconfigState;
    assert_eq!(mng::preconfig_control("xApply"), "DeviceObject/preconfig/control/@props/xApply");
    assert_eq!(mng::preconfig_template("xLoad"), "DeviceObject/preconfig/control/template/@props/xLoad");
    // `resourcesList` keeps its plural: `$resources`.
    assert_eq!(mng::preconfig_resource(1, "mode"), "DeviceObject/preconfig/control/$resources/@items/1/@props/mode");
    assert_eq!(mng::preconfig_output("MTVW", "mode"), "DeviceObject/preconfig/control/$output/@items/MTVW/@props/mode");
    assert_eq!(mng::preconfig_screen(1, "backgroundLayerType"), "DeviceObject/preconfig/control/$screen/@items/1/@props/backgroundLayerType");
    assert_eq!(mng::preconfig_aux_enable(2), "DeviceObject/preconfig/control/$auxiliaryScreen/@items/2/@props/enable");
    assert_eq!(mng::preconfig_status("computeDone"), "DeviceObject/preconfig/status/@props/computeDone");
    assert_eq!(mng::preconfig_output_validity("1", "modeValidity"), "DeviceObject/preconfig/status/$output/@items/1/@props/modeValidity");
    // The store's `outputList` property answers as `$output` — the device
    // rewrites the reply path even when asked for `outputList`.
    assert_eq!(mng::preconfig_state_screen(PreconfigState::New, 1, "$output"), "DeviceObject/preconfig/status/$state/@items/NEW/$screen/@items/1/@props/$output");
    // The applied state is where `output_role` and `screen_is_enabled` already read.
    assert_eq!(mng::preconfig_state_output(PreconfigState::Current, "1", "mode"), mng::output_role("1"));
    assert_eq!(mng::preconfig_state_aux(PreconfigState::Current, 1, "mode"), "DeviceObject/preconfig/status/$state/@items/CURRENT/$auxiliaryScreen/@items/1/@props/mode");
}

#[test]
fn configuration_slots_back_up_and_restore_in_two_steps() {
    assert_eq!(mng::config_slot_status(1, "status"), "DeviceObject/system/configuration/storage/$bank/@items/SLOT_1/status/@props/status");
    assert_eq!(mng::config_slot_delete(2), "DeviceObject/system/configuration/storage/$bank/@items/SLOT_2/delete/cmd/@props/xRequest");
    assert_eq!(mng::config_export("xRequest"), "DeviceObject/system/configuration/backup/export/cmd/@props/xRequest");
    assert_eq!(mng::config_import_extract("source"), "DeviceObject/system/configuration/backup/import/extract/cmd/@props/source");
    assert_eq!(mng::config_import_apply("stillOption"), "DeviceObject/system/configuration/backup/import/apply/cmd/@props/stillOption");
    assert_eq!(mng::config_import_apply_status("progress"), "DeviceObject/system/configuration/backup/import/apply/status/@props/progress");
    assert_eq!(mng::CONFIG_SLOTS, 2);
}

#[test]
fn streaming_has_ten_destinations_and_one_stream() {
    assert_eq!(mng::stream_destination(1, "url"), "DeviceObject/streaming/destinationBank/$slot/@items/1/@props/url");
    assert_eq!(mng::stream_remember_keys(), "DeviceObject/streaming/destinationBank/@props/rememberKeys");
    assert_eq!(mng::stream_control("start"), "DeviceObject/streaming/control/@props/start");
    assert_eq!(mng::stream_target(), "DeviceObject/streaming/control/destination/@props/target");
    assert_eq!(mng::stream_video("profile"), "DeviceObject/streaming/control/video/@props/profile");
    assert_eq!(mng::stream_audio_live("mute"), "DeviceObject/streaming/control/audio/live/@props/mute");
    assert_eq!(mng::stream_video_status("sourceValidity"), "DeviceObject/streaming/status/video/@props/sourceValidity");
    assert_eq!(mng::STREAM_DESTINATIONS, 10);
}

#[test]
fn audio_is_sources_and_routing_points_not_a_matrix() {
    use mng::AudioSide;
    // Every spelling written on the simulator and read back (mynah, 2026-09-13; this crate, 2026-09-15).
    assert_eq!(mng::audio_control("masterRate"), "DeviceObject/audio/control/@props/masterRate");
    assert_eq!(mng::audio_source_is_available("IN_DANTE_CH1_8"), "DeviceObject/audio/$source/@items/IN_DANTE_CH1_8/status/@props/isAvailable");
    assert_eq!(mng::audio_input_status("IN1_SDI_EMBEDDED", "isAudioDetected"), "DeviceObject/audio/$input/@items/IN1_SDI_EMBEDDED/status/@props/isAudioDetected");
    assert_eq!(mng::audio_input_channel_mute("IN1_SDI_EMBEDDED", 3), "DeviceObject/audio/$input/@items/IN1_SDI_EMBEDDED/$channel/@items/3/control/@props/mute");
    // `inputList/level` is a sibling of `items`, so it is `$input/level`.
    assert_eq!(mng::audio_level_select(AudioSide::Input), "DeviceObject/audio/$input/level/control/@props/select");
    assert_eq!(mng::audio_level(AudioSide::Output), "DeviceObject/audio/$output/level/status/@props/level");
    assert_eq!(mng::audio_output_mute("VIDEO_OUT_1"), "DeviceObject/audio/$output/@items/VIDEO_OUT_1/control/@props/mute");
    assert_eq!(mng::audio_line_out_direct(2), "DeviceObject/audio/$lineOut/@items/2/control/directRouting/@props/source");
    assert_eq!(mng::audio_line_out_follow(1), "DeviceObject/audio/$lineOut/@items/1/control/followScreen/@props/screen");
    assert_eq!(mng::audio_destination_mute(Dest::Aux(2)), "DeviceObject/audio/$auxiliaryScreen/@items/2/control/@props/mute");
    assert_eq!(mng::audio_custom(10, "channelMapping"), "DeviceObject/audio/custom/$source/@items/CUSTOM_10/control/@props/channelMapping");
    assert_eq!(mng::dante_group_follow(4), "DeviceObject/audio/dante/$outputGroup/@items/4/control/followScreen/@props/screen");
    assert_eq!(mng::destination_audio_mode(Dest::Screen(1)), "DeviceObject/$screen/@items/1/audio/control/@props/mode");
    assert_eq!(mng::screen_audio_follow_layer(1), "DeviceObject/$screen/@items/1/audio/control/followLiveLayer/@props/layer");
    assert_eq!(mng::audio_layer(Dest::Screen(1), Buffer::Down), "DeviceObject/$screen/@items/1/$preset/@items/DOWN/audio/control/@props/source");
    assert_eq!(mng::output_audio_mode("MTVW"), "DeviceObject/$output/@items/MTVW/audio/control/@props/mode");
    assert_eq!(mng::mvw_audio_vu_widget(), "DeviceObject/multiviewer/audio/control/vuMeters/@props/widget");
    assert_eq!(mng::quick_preset_audio_mode(), "DeviceObject/quickPreset/control/audio/@props/mode");
}

#[test]
fn a_save_records_what_its_filter_says() {
    assert_eq!(mng::save_filter(Dest::Screen(2), "layerFilter"), "DeviceObject/preset/bank/control/save/$screen/@items/2/@props/layerFilter");
    assert_eq!(mng::save_filter(Dest::Aux(1), "categoryFilter"), "DeviceObject/preset/auxBank/control/save/$auxiliaryScreen/@items/1/@props/categoryFilter");
    assert_eq!(mng::master_save_filter("screenFilter"), "DeviceObject/preset/masterBank/control/save/@props/screenFilter");
    // The mode and the bank slots sit on the same node as the filters.
    assert!(mng::master_save_mode().starts_with("DeviceObject/preset/masterBank/control/save/@props/"));
}

#[test]
fn luts_soft_edge_and_autoscale_are_spelled_where_the_simulator_answers() {
    use mng::{GridDim, LutKind};
    // Probed on the Midra 4K simulator 2026-09-15; the store dump spells the same.
    assert_eq!(mng::lut_bank(LutKind::Conversion, 1, "label"), "DeviceObject/lutLibraries/conversion/$bank/@items/1/control/@props/label");
    assert_eq!(mng::lut_bank_status(LutKind::Correction, 2, "colorSpace"), "DeviceObject/lutLibraries/correction/$bank/@items/2/status/@props/colorSpace");
    // `inputLutResourceList` keeps the singular of its own name: `$inputLutResource`.
    assert_eq!(mng::lut_resource(3), "DeviceObject/$inputLutResource/@items/3/control/@props/useOnInput");
    // The conversion LUT hangs off control/status; the correction one off settings.
    assert_eq!(mng::plug_conversion_lut(1, 1, "source"), "DeviceObject/$input/@items/INPUT_1/$plug/@items/1/control/conversionLut/@props/source");
    assert_eq!(mng::plug_conversion_lut_status(1, 1, "sourceValidity"), "DeviceObject/$input/@items/INPUT_1/$plug/@items/1/status/conversionLut/@props/sourceValidity");
    assert_eq!(mng::plug_correction_lut(1, 1, "mode"), "DeviceObject/$input/@items/INPUT_1/$plug/@items/1/settings/correctionLut/control/@props/mode");
    assert_eq!(mng::output_conversion_lut("1", "mode"), "DeviceObject/$output/@items/1/conversionLut/control/@props/mode");
    assert_eq!(mng::output_correction_lut_status("MTVW", "state"), "DeviceObject/$output/@items/MTVW/settings/correctionLut/status/@props/state");
    assert_eq!(mng::screen_grid_softedge(1, GridDim::Column, 1, "curve/@props/enable"), "DeviceObject/$screen/@items/1/canvas/grid/$columnSpacing/@items/1/softedge/curve/@props/enable");
    assert_eq!(mng::screen_grid_softedge(2, GridDim::Row, 3, "blackLevel/@props/offset"), "DeviceObject/$screen/@items/2/canvas/grid/$rowSpacing/@items/3/softedge/blackLevel/@props/offset");
    // Autoscale on load is a per-screen flag on the screen bank's control, not on the load node.
    assert_eq!(mng::preset_auto_scale(2), "DeviceObject/preset/bank/control/$screen/@items/2/@props/autoScale");
    assert_eq!(mng::mvw_load_auto_scale(), "DeviceObject/multiviewer/$bank/control/load/@props/autoScale");
    assert_eq!(mng::LUT_RESOURCES, 4);
}
