//! Facts about the protocol that must not regress.
//!
//! Every message here is transcribed from the LivePremier AWJ Programmer's
//! Guide v6.2 or was observed on a device; where the two differ it is noted.

use openrcs_awj::paths::{self, Layer};
use openrcs_awj::{
    encode_get, encode_replace, Decoder, DeviceError, ErrorCode, Frame, Letters, Preset,
    Transition, Value,
};

const EOT: char = '\u{4}';

#[test]
fn messages_are_terminated_by_eot_not_newline() {
    let msg = encode_get("DeviceObject/system/$device/@items/1/@props/dev");
    assert_eq!(
        msg,
        format!("{{\"op\":\"get\",\"path\":\"DeviceObject/system/$device/@items/1/@props/dev\"}}{EOT}")
    );
    assert!(!msg.contains('\n'));
}

#[test]
fn replace_carries_the_value_as_json() {
    assert_eq!(
        encode_replace("/a/b/c", &Value::String("foo".into())),
        format!("{{\"op\":\"replace\",\"path\":\"/a/b/c\",\"value\":\"foo\"}}{EOT}")
    );
    assert_eq!(
        encode_replace(&paths::screen_take(1), &Value::Bool(true)),
        format!(
            "{{\"op\":\"replace\",\"path\":\"DeviceObject/$screenAuxGroup/@items/S1/control/@props/xTake\",\"value\":true}}{EOT}"
        )
    );
}

#[test]
fn a_reply_decodes_to_its_path_and_value() {
    let mut d = Decoder::new();
    let frames = d.feed_str(&format!("{{\"path\":\"/a/b/c\",\"value\":\"foo\"}}{EOT}"));
    assert_eq!(
        frames,
        vec![Frame::Value {
            path: "/a/b/c".into(),
            value: Value::String("foo".into())
        }]
    );
}

#[test]
fn an_error_reply_decodes_to_its_code() {
    let mut d = Decoder::new();
    // Straight from the guide, escaped quotes and all.
    let raw = r#"{"error":{"code":"E12","message":"Unexpected path \"DeviceObject/system/@props/div\""}}"#;
    let frames = d.feed_str(&format!("{raw}{EOT}"));
    assert_eq!(
        frames,
        vec![Frame::Error(DeviceError {
            code: ErrorCode::UnexpectedPath,
            message: "Unexpected path \"DeviceObject/system/@props/div\"".into(),
        })]
    );
}

#[test]
fn a_message_split_across_reads_is_buffered() {
    let mut d = Decoder::new();
    assert!(d.feed_str("{\"path\":\"/a\",\"val").is_empty());
    assert!(!d.pending().is_empty());
    let frames = d.feed_str(&format!("ue\":42}}{EOT}"));
    assert_eq!(
        frames,
        vec![Frame::Value {
            path: "/a".into(),
            value: Value::from(42)
        }]
    );
    assert!(d.pending().is_empty());
}

#[test]
fn several_messages_in_one_read_all_come_out() {
    let mut d = Decoder::new();
    let frames = d.feed_str(&format!(
        "{{\"path\":\"/a\",\"value\":1}}{EOT}{{\"path\":\"/b\",\"value\":2}}{EOT}"
    ));
    assert_eq!(frames.len(), 2);
}

#[test]
fn a_newline_inside_a_value_does_not_split_a_message() {
    // Why the terminator is 0x04 and not a newline: labels are free text.
    let mut d = Decoder::new();
    let frames = d.feed_str(&format!("{{\"path\":\"/a\",\"value\":\"two\\nlines\"}}{EOT}"));
    assert_eq!(frames.len(), 1);
    match &frames[0] {
        Frame::Value { value, .. } => assert_eq!(value.as_str(), Some("two\nlines")),
        other => panic!("expected a value frame, got {other:?}"),
    }
}

#[test]
fn a_null_value_is_a_value_not_a_missing_key() {
    let mut d = Decoder::new();
    let frames = d.feed_str(&format!("{{\"path\":\"/a\",\"value\":null}}{EOT}"));
    assert_eq!(
        frames,
        vec![Frame::Value {
            path: "/a".into(),
            value: Value::Null
        }]
    );
}

#[test]
fn junk_is_skipped_rather_than_killing_the_stream() {
    let mut d = Decoder::new();
    let frames = d.feed_str(&format!("not json{EOT}{{\"path\":\"/a\",\"value\":1}}{EOT}"));
    assert_eq!(frames.len(), 1);
}

#[test]
fn every_transition_state_names_the_end_it_is_at_or_came_from() {
    // The whole rule is the DOWN/UP suffix. Testing only for AT_UP gets the
    // four in-flight states backwards for exactly the length of a transition.
    for (s, program_is_down) in [
        ("AT_DOWN", true),
        ("EFFECT_FROM_DOWN", true),
        ("COPY_FROM_DOWN", true),
        ("AT_UP", false),
        ("EFFECT_FROM_UP", false),
        ("COPY_FROM_UP", false),
    ] {
        let t = Transition::parse(s).unwrap_or_else(|| panic!("{s} should parse"));
        assert_eq!(t.program_is_down(), program_is_down, "{s}");
    }
    assert_eq!(Transition::parse("SOMETHING_NEW"), None);
}

#[test]
fn letters_match_the_guides_tbar_table() {
    // Guide §3.8: AT DOWN → PGM is A, PRW is B; AT UP → PGM is B, PRW is A.
    let l = Letters::DOCUMENTED;
    assert_eq!(l.letter(Transition::AtDown, Preset::Program), 'A');
    assert_eq!(l.letter(Transition::AtDown, Preset::Preview), 'B');
    assert_eq!(l.letter(Transition::AtUp, Preset::Program), 'B');
    assert_eq!(l.letter(Transition::AtUp, Preset::Preview), 'A');
}

#[test]
fn letters_are_whatever_the_device_reports() {
    // A device reports its own; a third letter turns up in the wild, so the
    // guide's A/B is a default, not a rule.
    let l = Letters { down: 'C', up: 'A' };
    assert_eq!(l.letter(Transition::AtDown, Preset::Program), 'C');
    assert_eq!(l.letter(Transition::EffectFromUp, Preset::Program), 'A');
    assert_eq!(l.letter(Transition::EffectFromUp, Preset::Preview), 'C');
}

#[test]
fn documented_paths_are_built_verbatim() {
    assert_eq!(
        paths::screen_label(1),
        "DeviceObject/$screen/@items/S1/control/@props/label"
    );
    assert_eq!(
        paths::screen_transition(1),
        "DeviceObject/$screenAuxGroup/@items/S1/status/@props/transition"
    );
    assert_eq!(
        paths::load_screen_preset(33, 1, Preset::Preview),
        "DeviceObject/presetBank/control/load/$slot/@items/33/$screen/@items/S1/$preset/@items/PREVIEW/@props/xRequest"
    );
    assert_eq!(
        paths::load_aux_preset(8, 1, Preset::Program),
        "DeviceObject/presetBank/control/load/$slot/@items/8/$auxiliary/@items/A1/$preset/@items/PROGRAM/@props/xRequest"
    );
    assert_eq!(
        paths::load_master_preset(15, Preset::Preview),
        "DeviceObject/masterPresetBank/control/load/$slot/@items/15/$preset/@items/PREVIEW/@props/xRequest"
    );
    assert_eq!(
        paths::layer_source(1, 'A', Layer::N(2)),
        "DeviceObject/$screen/@items/S1/$preset/@items/A/$layer/@items/2/source/@props/inputNum"
    );
    assert_eq!(
        paths::aux_layer_source(1, 'A', Layer::N(2)),
        "DeviceObject/$auxiliary/@items/A1/$preset/@items/A/$layer/@items/2/source/@props/inputNum"
    );
    assert_eq!(
        paths::global_update(),
        "DeviceObject/$screenAuxGroup/control/@props/xUpdate"
    );
    assert_eq!(
        paths::master_preset_label(3),
        "DeviceObject/masterPresetBank/$bank/@items/3/control/@props/label"
    );
}

#[test]
fn the_native_layer_has_a_key_of_its_own() {
    assert_eq!(
        paths::layer_source(2, 'B', Layer::Native),
        "DeviceObject/$screen/@items/S2/$preset/@items/B/$layer/@items/NATIVE/source/@props/inputNum"
    );
}

#[test]
fn a_path_needing_escapes_still_produces_valid_json() {
    let msg = encode_get("weird\"path\\here");
    let body = msg.trim_end_matches(EOT);
    let v: Value = serde_json::from_str(body).expect("must stay parseable");
    assert_eq!(v["path"].as_str(), Some("weird\"path\\here"));
}
