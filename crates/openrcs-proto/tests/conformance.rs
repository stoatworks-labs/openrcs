//! Conformance vectors — known-good frames a device produces on the wire.
//!
//! Each byte string is a real frame in the Analog Way LiveCore control
//! protocol; together they pin the codec to observed device behaviour. If a
//! change breaks one of these, the codec has diverged from the protocol.

use openrcs_proto::*;

const LC: Platform = Platform::LiveCore;

fn one(bytes: &[u8]) -> Frame {
    let mut d = Decoder::new();
    let out = d.feed(bytes);
    assert_eq!(out.len(), 1, "expected exactly one frame from {bytes:?}");
    assert!(d.pending().is_empty(), "leftover after {bytes:?}");
    out.into_iter().next().unwrap()
}

fn reply(bytes: &[u8]) -> Reply {
    match one(bytes) {
        Frame::Value(r) => r,
        Frame::Error(c) => panic!("expected value, got error {c}"),
    }
}

#[test]
fn identify_replies_match_the_table() {
    // `?` answers with DEV, `!` with PDEV, `*` with `*` — the asymmetric
    // answer mnemonics in the table.
    for (sent, bytes, answer) in [
        ("?", &b"DEV0\r\n"[..], "DEV"),
        ("!", &b"PDEV97\r\n"[..], "PDEV"),
        ("*", &b"*0\r\n"[..], "*"),
    ] {
        let r = reply(bytes);
        assert_eq!(r.mnemonic, answer);
        let def = LC.lookup(sent).expect("mnemonic in table");
        assert_eq!(def.answer, answer, "table answer for {sent}");
        assert_eq!(LC.lookup_answer(&r.mnemonic).unwrap().mnemonic, sent);
    }
}

#[test]
fn platform_reply_carries_the_nextage_16_device_id() {
    // PDEV97 — 97 is the NeXtage 16's device id.
    let r = reply(b"PDEV97\r\n");
    assert_eq!(r.value, 97);
    assert!(r.indices.is_empty());
}

#[test]
fn unsolicited_push_on_connect_decodes() {
    // The device pushes INTERFACE_CONNECTED_CONTROLLERS on connect, before any
    // request — proof the link is push, not poll-only.
    let r = reply(b"ITcct0,1\r\n");
    assert_eq!(r.mnemonic, "ITcct");
    assert_eq!(r.indices, vec![0]);
    assert_eq!(r.value, 1);
    assert_eq!(LC.lookup_answer("ITcct").unwrap().name, "INTERFACE_CONNECTED_CONTROLLERS");
}

#[test]
fn indexed_replies_round_trip() {
    let r = reply(b"VEvar0,13\r\n");
    assert_eq!((r.mnemonic.as_str(), &r.indices[..], r.value), ("VEvar", &[0][..], 13));

    let r = reply(b"VEmic0,1,0\r\n");
    assert_eq!((r.mnemonic.as_str(), &r.indices[..], r.value), ("VEmic", &[0, 1][..], 0));
}

#[test]
fn encoder_produces_wire_bytes_the_device_accepts() {
    assert_eq!(encode_get(LC, "INpcr", &[5]), "5,INpcr\n");
    assert_eq!(encode_set(LC, "INpcr", &[5], 200), "5,200INpcr\n");
    assert_eq!(encode_get_checked(LC, "INpcr", &[5]).unwrap(), "5,INpcr\n");
    assert_eq!(encode_set_checked(LC, "INpcr", &[5], 200).unwrap(), "5,200INpcr\n");
}

#[test]
fn set_reply_confirms_the_new_value() {
    // A set echoes the applied value back as a normal value frame.
    let r = reply(b"INpcr5,200\r\n");
    assert_eq!((r.mnemonic.as_str(), &r.indices[..], r.value), ("INpcr", &[5][..], 200));
}

#[test]
fn error_frames_are_classified_not_mistaken_for_values() {
    assert_eq!(one(b"E10\r\n"), Frame::Error(10)); // unknown command
    assert_eq!(one(b"E12\r\n"), Frame::Error(12)); // wrong index count

    // Client-side validation catches the wrong-rank case before it reaches the
    // wire, so a well-behaved client never provokes an E12.
    let err = encode_get_checked(LC, "VEmic", &[0]).unwrap_err();
    assert!(matches!(err, Error::WrongRank { expected: 2, got: 1, .. }));
}

#[test]
fn a_full_transcript_decodes_in_order() {
    let stream = b"ITcct0,1\r\nDEV0\r\nPDEV97\r\n*0\r\nVEvar0,13\r\n\
                   COdlv0\r\nINpcr5,0\r\nINpcr5,200\r\nE10\r\nE12\r\n";
    let mut d = Decoder::new();
    let frames = d.feed(stream);
    assert_eq!(frames.len(), 10);
    assert_eq!(frames[8], Frame::Error(10));
    assert_eq!(frames[9], Frame::Error(12));
    let values = frames.iter().filter(|f| matches!(f, Frame::Value(_))).count();
    assert_eq!(values, 8);
    assert!(d.pending().is_empty());
}
