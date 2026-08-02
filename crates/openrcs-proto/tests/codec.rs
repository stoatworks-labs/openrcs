use openrcs_proto::*;

// ---------------------------------------------------------------- encoding

#[test]
fn midra_set_matches_vendor_format() {
    // Each index followed by a comma, value bare, mnemonic last, CRLF.
    assert_eq!(
        encode_set(Platform::Midra, "PMinp", &[1, 2], 5),
        "1,2,5PMinp\r\n"
    );
}

#[test]
fn midra_get_keeps_the_trailing_comma() {
    // One comma per index and nothing for the value.
    assert_eq!(encode_get(Platform::Midra, "PMinp", &[1, 2]), "1,2,PMinp\r\n");
}

#[test]
fn no_indices_means_no_commas() {
    assert_eq!(encode_set(Platform::Midra, "GCtal", &[], 1), "1GCtal\r\n");
    assert_eq!(encode_get(Platform::Midra, "GCtal", &[]), "GCtal\r\n");
}

#[test]
fn livecore_terminates_with_lf_not_crlf() {
    // LiveCore appends '\n', not CRLF.
    assert_eq!(encode_set(Platform::LiveCore, "PCmrs", &[], 1), "1PCmrs\n");
    assert!(!encode_set(Platform::LiveCore, "PCmrs", &[], 1).contains('\r'));
}

#[test]
fn tbar_half_travel_on_screen_one() {
    let v = Platform::Midra.lookup("GCtba").unwrap();
    assert_eq!(v.name, "TBAR");
    assert_eq!(v.dims, &[2]);
    assert_eq!((v.min, v.max), (0, 10000));
    assert_eq!(encode_set(Platform::Midra, "GCtba", &[1], 5000), "1,5000GCtba\r\n");
}

// ---------------------------------------------------------------- decoding

#[test]
fn reply_puts_the_mnemonic_first() {
    let r = parse_reply("PMinp1,2,5").unwrap();
    assert_eq!(r.mnemonic, "PMinp");
    assert_eq!(r.indices, vec![1, 2]);
    assert_eq!(r.value, 5);
}

#[test]
fn last_field_is_the_value_not_an_index() {
    let r = parse_reply("OUpmn1,3,7,42").unwrap();
    assert_eq!(r.indices, vec![1, 3, 7]);
    assert_eq!(r.value, 42);
}

#[test]
fn reply_with_no_indices() {
    let r = parse_reply("GCtal1").unwrap();
    assert!(r.indices.is_empty());
    assert_eq!(r.value, 1);
}

#[test]
fn negative_value_without_indices_decodes() {
    // A leading '-' after the mnemonic is treated as the start of the value.
    let r = parse_reply("IEbri-50").unwrap();
    assert_eq!(r.mnemonic, "IEbri");
    assert_eq!(r.value, -50);
}

#[test]
fn negative_value_after_indices_decodes() {
    let r = parse_reply("IEbri1,2,-50").unwrap();
    assert_eq!(r.indices, vec![1, 2]);
    assert_eq!(r.value, -50);
}

#[test]
fn junk_without_a_numeric_tail_is_rejected() {
    assert!(parse_reply("HELLO").is_err());
    assert!(parse_reply("").is_err());
}

// ------------------------------------------------------- streaming decoder

fn value(f: &Frame) -> &Reply {
    match f {
        Frame::Value(r) => r,
        Frame::Error(c) => panic!("expected value, got error {c}"),
    }
}

#[test]
fn decoder_splits_multiple_replies_in_one_read() {
    let mut d = Decoder::new();
    let out = d.feed(b"GCtak0,1\nGCtba1,5000\n");
    assert_eq!(out.len(), 2);
    assert_eq!(value(&out[0]).mnemonic, "GCtak");
    assert_eq!(value(&out[1]).value, 5000);
    assert!(d.pending().is_empty());
}

#[test]
fn decoder_buffers_a_split_line_across_reads() {
    let mut d = Decoder::new();
    assert!(d.feed(b"GCtba1,50").is_empty());
    assert_eq!(d.pending(), "GCtba1,50");
    let out = d.feed(b"00\n");
    assert_eq!(out.len(), 1);
    assert_eq!(value(&out[0]).value, 5000);
}

#[test]
fn decoder_tolerates_crlf_from_the_device() {
    // The device terminates replies with CRLF even on LiveCore.
    let mut d = Decoder::new();
    let out = d.feed(b"GCtak0,1\r\n");
    assert_eq!(out.len(), 1);
    assert_eq!(value(&out[0]).value, 1);
}

#[test]
fn decoder_recognises_error_frames() {
    let mut d = Decoder::new();
    let out = d.feed(b"E10\r\nE12\r\n");
    assert_eq!(out, vec![Frame::Error(10), Frame::Error(12)]);
}

#[test]
fn round_trip_set_then_reply() {
    let wire = encode_set(Platform::Midra, "PMinp", &[1, 2], 5);
    assert_eq!(wire, "1,2,5PMinp\r\n");

    // The device echoes state back in the mirrored form.
    let mut d = Decoder::new();
    let out = d.feed(b"PMinp1,2,5\n");
    assert_eq!(value(&out[0]).indices, vec![1, 2]);
    assert_eq!(value(&out[0]).value, 5);
}

// ---------------------------------------------------------------- validation

#[test]
fn rank_mismatch_is_caught() {
    let e = encode_set_checked(Platform::Midra, "GCtba", &[], 5000).unwrap_err();
    assert!(matches!(e, Error::WrongRank { expected: 1, got: 0, .. }));
}

#[test]
fn index_bound_is_enforced() {
    // TBAR has dims [2], so screen 2 does not exist.
    let e = encode_set_checked(Platform::Midra, "GCtba", &[2], 0).unwrap_err();
    assert!(matches!(e, Error::IndexOutOfRange { bound: 2, index: 2, .. }));
}

#[test]
fn value_range_is_enforced() {
    let e = encode_set_checked(Platform::Midra, "GCtba", &[0], 10_001).unwrap_err();
    assert!(matches!(e, Error::ValueOutOfRange { max: 10000, .. }));
}

#[test]
fn read_only_variables_reject_writes() {
    let ro = Platform::Midra
        .vars()
        .iter()
        .find(|v| v.read_only && v.dims.is_empty())
        .expect("some read-only scalar exists");
    let e = encode_set_checked(Platform::Midra, ro.mnemonic, &[], ro.min)
        .unwrap_err();
    assert!(matches!(e, Error::ReadOnly(_)));
}

#[test]
fn unknown_mnemonic_is_rejected() {
    let e = encode_set_checked(Platform::Midra, "ZZzzz", &[], 0).unwrap_err();
    assert_eq!(e, Error::UnknownMnemonic);
}

// ---------------------------------------------------------------- the tables

#[test]
fn tables_have_the_expected_size() {
    assert_eq!(midra::VARS.len(), 562);
    assert_eq!(livecore::VARS.len(), 1014);
}

#[test]
fn tables_are_sorted_and_unique_so_binary_search_is_valid() {
    for t in [midra::VARS, livecore::VARS] {
        for w in t.windows(2) {
            assert!(w[0].mnemonic < w[1].mnemonic, "unsorted at {}", w[0].mnemonic);
        }
    }
}

#[test]
fn every_variable_is_findable_by_its_own_mnemonic() {
    for (p, t) in [
        (Platform::Midra, midra::VARS),
        (Platform::LiveCore, livecore::VARS),
    ] {
        for v in t {
            assert_eq!(p.lookup(v.mnemonic).map(|f| f.name), Some(v.name));
            assert!(p.lookup_answer(v.answer).is_some(), "{}", v.answer);
        }
    }
}

#[test]
fn declared_ranges_are_coherent() {
    for t in [midra::VARS, livecore::VARS] {
        for v in t {
            assert!(v.min <= v.max, "{} has min > max", v.mnemonic);
            assert!(!v.mnemonic.is_empty());
            assert!(v.dims.iter().all(|&d| d > 0), "{} has a zero axis", v.mnemonic);
        }
    }
}

#[test]
fn only_the_debug_specials_have_an_asymmetric_answer() {
    let mut odd: Vec<_> = midra::VARS
        .iter()
        .filter(|v| v.mnemonic != v.answer)
        .map(|v| v.name)
        .collect();
    odd.sort_unstable();
    assert_eq!(odd, vec!["DBG_ADDR", "DBG_DATA", "DEV"]);
}

#[test]
fn platform_metadata_is_correct() {
    assert_eq!(Platform::Midra.terminator(), "\r\n");
    assert_eq!(Platform::LiveCore.terminator(), "\n");
    assert_eq!(Platform::Midra.port(), 10500);
    assert_eq!(Platform::LiveCore.port(), 10500);
}
