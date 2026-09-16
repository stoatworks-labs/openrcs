//! The Pulse PLS300 — the generation before Midra.
//!
//! Every wire string here is taken from the "Programmer's Guide For PLS300"
//! (chapters A2–A4), not from a unit: no PLS300 has answered openrcs yet. What
//! these pin is that the shared codec produces the guide's command spellings
//! and decodes its documented answers, and that the generated table carries
//! the properties the surface relies on.

use openrcs_proto::*;

const P: Platform = Platform::Pls300;

// ---------------------------------------------------------------- framing

#[test]
fn commands_carry_no_terminator() {
    // A2: "There is no starting/ending code needed in a command string" — the
    // mnemonic itself ends the command, so nothing follows it.
    assert_eq!(P.terminator(), "");
    assert_eq!(encode_set(P, "IN", &[1, 2], 4), "1,2,4IN");
    assert_eq!(encode_set(P, "YB", &[], 4), "4YB");
}

#[test]
fn reads_end_in_the_mnemonic_with_one_comma_per_index() {
    // A2: read command = [[index,] ...] + code — "1,2,IN" or "YB".
    assert_eq!(encode_get(P, "IN", &[1, 2]), "1,2,IN");
    assert_eq!(encode_get(P, "YB", &[]), "YB");
    assert_eq!(encode_get(P, "TA", &[]), "TA");
}

#[test]
fn same_port_as_the_series_that_followed() {
    assert_eq!(P.port(), 10500);
}

// ---------------------------------------------------------------- the guide's examples

#[test]
fn a3_examples_decode_as_printed() {
    // 1) OFORMAT with one index: "0,12OF" answered "OF0,12".
    assert_eq!(encode_set(P, "OF", &[0], 12), "0,12OF");
    let r = parse_reply("OF0,12").unwrap();
    assert_eq!((r.mnemonic.as_str(), &r.indices[..], r.value), ("OF", &[0][..], 12));

    // 2) PE_INPUTNUM with two indices. The guide prints the answer as
    // "IN1,1,4" for a "1,2,4IN" command — its own inconsistency, kept here
    // as printed rather than corrected, since nothing has been measured.
    let r = parse_reply("IN1,1,4").unwrap();
    assert_eq!((r.mnemonic.as_str(), &r.indices[..], r.value), ("IN", &[1, 1][..], 4));

    // 3) A read without index: "TA" answered "TA1".
    let r = parse_reply("TA1").unwrap();
    assert_eq!((r.mnemonic.as_str(), r.indices.len(), r.value), ("TA", 0, 1));

    // 4) A lower-case mnemonic: "3,so" answered "so3,2".
    assert_eq!(encode_get(P, "so", &[3]), "3,so");
    let r = parse_reply("so3,2").unwrap();
    assert_eq!((r.mnemonic.as_str(), &r.indices[..], r.value), ("so", &[3][..], 2));
}

#[test]
fn a4_error_codes_include_the_index_value_error() {
    // E11 does not exist on Midra or LiveCore; the PLS300 answers it for an
    // index that is the right count but out of range.
    let mut d = Decoder::new();
    let frames = d.feed(b"E10\r\nE11\r\nE12\r\n");
    assert_eq!(frames, vec![Frame::Error(10), Frame::Error(11), Frame::Error(12)]);
}

#[test]
fn replies_are_crlf_terminated_like_the_rest_of_the_family() {
    // A1: "All responses ... end with a carriage return <CR> and a line feed".
    let mut d = Decoder::new();
    let frames = d.feed(b"OF0,12\r\nTA1\r\n");
    assert_eq!(frames.len(), 2);
    assert!(d.pending().is_empty());
}

// ---------------------------------------------------------------- the table

#[test]
fn mnemonics_are_two_case_sensitive_letters() {
    // NC and Nc are different variables; nothing longer than two letters
    // exists, and the only one-character entries are the three specials.
    let nc = P.lookup("NC").unwrap();
    let nc_lower = P.lookup("Nc").unwrap();
    assert_eq!(nc.name, "PREVIEWED_LAYER");
    assert_eq!(nc_lower.name, "COPY_CTRL");
    for v in P.vars() {
        match v.mnemonic.len() {
            1 => assert!(matches!(v.mnemonic, "#" | "*" | "?"), "{}", v.mnemonic),
            2 => assert!(v.mnemonic.chars().all(|c| c.is_ascii_alphabetic()), "{}", v.mnemonic),
            _ => panic!("{} is neither a special nor two letters", v.mnemonic),
        }
    }
}

#[test]
fn table_is_sorted_for_binary_search() {
    let t = P.vars();
    assert!(t.windows(2).all(|w| w[0].mnemonic < w[1].mnemonic));
    assert_eq!(t.len(), 222);
}

#[test]
fn identify_answers_dev_78() {
    // `?` is answered as `DEV`, the same special as Midra, with the PLS-300's
    // own code. This is what tells the two 10500 generations apart.
    let v = P.lookup("?").unwrap();
    assert_eq!(v.answer, "DEV");
    assert_eq!((v.min, v.max, v.default), (78, 78, 78));
    assert!(v.read_only);
    assert_eq!(P.lookup_answer("DEV").map(|v| v.mnemonic), Some("?"));
}

#[test]
fn the_preset_element_grid_is_seven_presets_by_ten_layers() {
    // Index 1: current, next, previous, memory 1–4. Index 2: the layer slots
    // (background frame, background live, PiP, logos, audio).
    let v = P.lookup("IN").unwrap();
    assert_eq!(v.name, "PE_INPUTNUM");
    assert_eq!(v.dims, &[7, 10]);
    assert_eq!((v.min, v.max), (0, 12));
    assert_eq!(P.lookup("TK").unwrap().name, "TAKE");
    assert_eq!(P.lookup("NT").unwrap().max, 10000);
}

#[test]
fn checked_encoding_uses_the_table() {
    assert_eq!(encode_set_checked(P, "IN", &[1, 2], 4).unwrap(), "1,2,4IN");
    assert!(matches!(
        encode_set_checked(P, "IN", &[7, 0], 4).unwrap_err(),
        Error::IndexOutOfRange { axis: 0, index: 7, bound: 7, .. }
    ));
    assert!(matches!(
        encode_set_checked(P, "IN", &[1, 2], 13).unwrap_err(),
        Error::ValueOutOfRange { value: 13, max: 12, .. }
    ));
    // Sf is indexed by input slot 0..11 (inputs 1–6 and 9–12); the Companion
    // module's 1-based ids overrun it by one.
    assert!(encode_set_checked(P, "Sf", &[12], 1).is_err());
    assert_eq!(encode_set_checked(P, "Sf", &[11], 1).unwrap(), "11,1Sf");
    assert!(matches!(encode_get_checked(P, "PMinp", &[]).unwrap_err(), Error::UnknownMnemonic));
}
