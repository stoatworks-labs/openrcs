//! Stamps the binary with the commit it was built from, so `--version` and
//! the startup banner can say which build is running — a bug report that
//! quotes `0.7.0 (f219a9d)` is one that can be reproduced.
//!
//! The sha comes from `git rev-parse` when the source is a checkout, or from
//! an `OPENRCS_GIT_SHA` environment variable when it is not (a source tarball,
//! a packaging system that strips `.git`). With neither, nothing is emitted
//! and `option_env!` in `main.rs` reads `None`: the version alone is still
//! right, so the fallback is silence rather than a failed build.

use std::process::Command;

fn git(args: &[&str]) -> Option<String> {
    let out = Command::new("git").args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8(out.stdout).ok()?;
    let s = s.trim();
    (!s.is_empty()).then(|| s.to_string())
}

fn main() {
    println!("cargo:rerun-if-env-changed=OPENRCS_GIT_SHA");
    if std::env::var_os("OPENRCS_GIT_SHA").is_some() {
        // An explicit stamp wins; rustc sees the same variable, so there is
        // nothing to forward.
        return;
    }

    // Re-run when HEAD moves — a commit, a checkout — so a rebuild carries
    // the new sha rather than the one from the last clean build. `--git-path`
    // resolves the real files under a worktree's `.git` too. Only files that
    // exist are registered: cargo re-runs a build script on every build when
    // a registered path is missing, and a branch's loose ref file is absent
    // once it has been packed.
    let mut watched = vec![git(&["rev-parse", "--git-path", "HEAD"])];
    if let Some(branch) = git(&["symbolic-ref", "-q", "HEAD"]) {
        watched.push(git(&["rev-parse", "--git-path", &branch]));
    }
    watched.push(git(&["rev-parse", "--git-path", "packed-refs"]));
    for path in watched.into_iter().flatten() {
        if std::path::Path::new(&path).exists() {
            println!("cargo:rerun-if-changed={path}");
        }
    }

    if let Some(sha) = git(&["rev-parse", "--short", "HEAD"]) {
        println!("cargo:rustc-env=OPENRCS_GIT_SHA={sha}");
    }
}
