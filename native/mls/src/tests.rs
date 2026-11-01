use super::*;

const GID: &[u8] = b"call:test";
const DS_ID: &[u8] = b"alga-ds";
const LABEL: &str = "Alga Media v1";

fn client(i: usize) -> Client {
    Client::new(format!("user{i}:device").as_bytes()).unwrap()
}

/// Creator + `n - 1` members added by DS proposals in one commit (the DS echoes the commit to its author).
fn group_of(ds: &Client, n: usize) -> Vec<Client> {
    let mut creator = client(0);
    creator
        .create_group(GID, &ds.signature_public_key(), DS_ID)
        .unwrap();
    let mut joiners: Vec<Client> = (1..n).map(client).collect();
    if !joiners.is_empty() {
        for j in &joiners {
            let p = ds
                .external_propose_add(GID, creator.epoch().unwrap(), &j.key_package().unwrap())
                .unwrap();
            assert_eq!(creator.process(&p).unwrap(), "proposal");
        }
        let c = creator.commit_pending().unwrap();
        assert_eq!(creator.process(&c.commit).unwrap(), "commit");
        let welcome = c.welcome.unwrap();
        for j in &mut joiners {
            j.process_welcome(&welcome).unwrap();
        }
    }
    let mut all = vec![creator];
    all.extend(joiners);
    all
}

/// Every member derives the same exporter secret (and the same epoch); returns it.
fn agreed(members: &mut [Client]) -> Vec<u8> {
    let epoch = members[0].epoch().unwrap();
    let s0 = members[0]
        .export_secret(LABEL, b"user0\0device", 32)
        .unwrap();
    for m in members.iter_mut() {
        assert_eq!(m.epoch().unwrap(), epoch);
        assert_eq!(m.export_secret(LABEL, b"user0\0device", 32).unwrap(), s0);
    }
    s0
}

/// DS proposal → everyone validates it → member 0 commits → everyone processes the commit.
fn ds_epoch(members: &mut [Client], proposal: &[u8]) -> Commit {
    for m in members.iter_mut() {
        assert_eq!(m.process(proposal).unwrap(), "proposal");
    }
    let c = members[0].commit_pending().unwrap();
    for m in members.iter_mut() {
        assert_eq!(m.process(&c.commit).unwrap(), "commit");
    }
    c
}

#[test]
fn groups_of_2_to_99_agree_per_epoch_and_removed_member_is_locked_out() {
    let ds = Client::new(DS_ID).unwrap();
    for n in [2, 10, 25, 99] {
        let mut g = group_of(&ds, n);
        let s1 = agreed(&mut g);

        // The DS removes the last member; it processes the commit like everyone else.
        let mut gone = g.pop().unwrap();
        let leaf = gone.own_leaf_index().unwrap();
        let remove = ds
            .external_propose_remove(GID, g[0].epoch().unwrap(), leaf)
            .unwrap();
        assert_eq!(gone.process(&remove).unwrap(), "proposal");
        let before = gone.save_state();
        let c = ds_epoch(&mut g, &remove);
        assert_eq!(gone.process(&c.commit).unwrap(), "removed");
        assert!(gone.export_secret(LABEL, b"user0\0device", 32).is_err());
        let s2 = agreed(&mut g);
        assert_ne!(s1, s2, "n={n}: epoch secret must rotate");

        // From its last good state the removed member can't follow the group either.
        let mut ghost = Client::load_state(&before).unwrap();
        assert_eq!(
            ghost.export_secret(LABEL, b"user0\0device", 32).unwrap(),
            s1
        );
        assert_eq!(ghost.process(&c.commit).unwrap(), "removed");
        if n > 2 {
            let newbie = client(1000);
            let add = ds
                .external_propose_add(GID, g[0].epoch().unwrap(), &newbie.key_package().unwrap())
                .unwrap();
            let c3 = ds_epoch(&mut g, &add);
            let mut ghost = Client::load_state(&before).unwrap();
            assert!(ghost.process(&add).is_err());
            assert!(ghost.process(&c3.commit).is_err());
            assert_ne!(agreed(&mut g), s2);
        }
    }
}

#[test]
fn tampered_commit_is_rejected_at_every_byte() {
    let ds = Client::new(DS_ID).unwrap();
    let mut g = group_of(&ds, 3);
    let joiner = client(3);
    let add = ds
        .external_propose_add(GID, g[0].epoch().unwrap(), &joiner.key_package().unwrap())
        .unwrap();
    for m in g.iter_mut() {
        m.process(&add).unwrap();
    }
    let c = g[0].commit_pending().unwrap();
    reject_every_flip(&mut g[1], &c.commit);
    // Failed attempts left no trace: the real commit still applies and agrees.
    for m in g.iter_mut() {
        assert_eq!(m.process(&c.commit).unwrap(), "commit");
    }
    agreed(&mut g);

    // A removal commit carries an UpdatePath (HPKE-encrypted path secrets): same check.
    let remove = ds
        .external_propose_remove(GID, g[0].epoch().unwrap(), 2)
        .unwrap();
    for m in g.iter_mut() {
        m.process(&remove).unwrap();
    }
    let c = g[0].commit_pending().unwrap();
    reject_every_flip(&mut g[1], &c.commit);
    assert_eq!(g[2].process(&c.commit).unwrap(), "removed");
    g.truncate(2);
    for m in g.iter_mut() {
        assert_eq!(m.process(&c.commit).unwrap(), "commit");
    }
    agreed(&mut g);
}

fn reject_every_flip(receiver: &mut Client, commit: &[u8]) {
    for i in 0..commit.len() {
        let mut bad = commit.to_vec();
        bad[i] ^= 0x01;
        assert!(
            receiver.process(&bad).is_err(),
            "byte {i} of {} accepted",
            commit.len()
        );
    }
}

#[test]
fn only_the_configured_ds_may_propose() {
    let ds = Client::new(DS_ID).unwrap();
    let impostor = Client::new(DS_ID).unwrap(); // same name, different key
    let mut g = group_of(&ds, 2);
    let kp = client(9).key_package().unwrap();
    let forged = impostor
        .external_propose_add(GID, g[0].epoch().unwrap(), &kp)
        .unwrap();
    assert!(g[1].process(&forged).is_err());
    let stale = ds
        .external_propose_add(GID, g[0].epoch().unwrap() + 1, &kp)
        .unwrap();
    assert!(g[1].process(&stale).is_err());
}

#[test]
fn state_round_trips_deterministically() {
    let ds = Client::new(DS_ID).unwrap();
    let mut g = group_of(&ds, 3);
    let blob = g[2].save_state();
    assert_eq!(blob, g[2].save_state());
    let restored = Client::load_state(&blob).unwrap();
    assert_eq!(restored.save_state(), blob);
    assert_eq!(
        restored.export_secret(LABEL, b"x", 32),
        g[2].export_secret(LABEL, b"x", 32)
    );

    // The restored client keeps following the group.
    g[2] = restored;
    let add = ds
        .external_propose_add(
            GID,
            g[0].epoch().unwrap(),
            &client(7).key_package().unwrap(),
        )
        .unwrap();
    ds_epoch(&mut g, &add);
    agreed(&mut g);

    // Identity alone (what goes to e2ee-identity.bin) round-trips too.
    let id = g[1].export_identity();
    let again = Client::from_identity(&id).unwrap();
    assert_eq!(again.signature_public_key(), g[1].signature_public_key());
    assert_eq!(again.export_identity(), id);
    assert!(Client::load_state(&blob[..blob.len() - 1]).is_err());
    assert!(Client::from_identity(&blob).is_err());
}

#[test]
fn member_add_and_remove_by_key_package() {
    let ds = Client::new(DS_ID).unwrap();
    let mut g = group_of(&ds, 2);
    let mut newcomers = vec![client(5), client(6)];
    let kps = [
        newcomers[0].key_package().unwrap(),
        newcomers[1].key_package().unwrap(),
    ]
    .concat();
    let c = g[0].add_members(&kps).unwrap();
    g[0].merge_pending_commit().unwrap();
    assert_eq!(g[1].process(&c.commit).unwrap(), "commit");
    let welcome = c.welcome.unwrap();
    for n in &mut newcomers {
        n.process_welcome(&welcome).unwrap();
    }
    g.extend(newcomers);
    agreed(&mut g);

    let mut gone = g.remove(1);
    let c = g[0]
        .remove_members(vec![gone.own_leaf_index().unwrap()])
        .unwrap();
    assert!(c.welcome.is_none());
    assert_eq!(g[0].process(&c.commit).unwrap(), "commit"); // DS echo of our own commit
    for m in g.iter_mut().skip(1) {
        assert_eq!(m.process(&c.commit).unwrap(), "commit");
    }
    assert_eq!(gone.process(&c.commit).unwrap(), "removed");
    agreed(&mut g);

    // Re-entry into the same call (same group id) with a fresh key package: the old state was dropped.
    // No secret of the old call survives (OpenMLS alone leaves the last epoch's HPKE keys behind).
    assert!(gone.provider.storage().values.read().unwrap().is_empty());
    let c = g[0].add_members(&gone.key_package().unwrap()).unwrap();
    g[0].merge_pending_commit().unwrap();
    for m in g.iter_mut().skip(1) {
        m.process(&c.commit).unwrap();
    }
    gone.process_welcome(&c.welcome.unwrap()).unwrap();
    g.push(gone);
    agreed(&mut g);
}

fn hex_of(b: &[u8]) -> String {
    super::hex(b)
}

/// The DS side (0004 §3.3) through `PublicCall`: it follows the real tree and relays only commits that cover exactly its
/// own proposals, with a Welcome for exactly the added key packages.
#[test]
fn public_call_follows_the_group_and_refuses_bad_commits() {
    let ds = Client::new(DS_ID).unwrap();
    let mut creator = client(0);
    creator
        .create_group(GID, &ds.signature_public_key(), DS_ID)
        .unwrap();
    let mut call = PublicCall::from_group_info(&creator.group_info().unwrap()).unwrap();
    assert_eq!(call.epoch(), 0);
    assert_eq!(call.group_id(), GID);
    assert!(call.has_external_sender(&ds.signature_public_key(), DS_ID));
    assert!(!call.has_external_sender(&client(99).signature_public_key(), DS_ID));
    assert!(call.members().contains(&hex_of(b"user0:device")));

    // Key package as the server sees it on upload.
    let mut joiner = client(1);
    let kp = joiner.key_package().unwrap();
    let info = inspect_key_package(&kp).unwrap();
    assert_eq!(info.identity, b"user1:device");
    assert_eq!(info.signature_key, joiner.signature_public_key());
    assert_eq!(info.reference.len(), 32);
    let mut bad_kp = kp.clone();
    let last = bad_kp.len() - 1;
    bad_kp[last] ^= 1;
    assert!(inspect_key_package(&bad_kp).is_err());

    // Add: the DS queues its own proposal; the committer's commit must come with a Welcome for that key package.
    let add = ds.external_propose_add(GID, 0, &kp).unwrap();
    call.add_proposal(&add).unwrap();
    assert_eq!(creator.process(&add).unwrap(), "proposal");
    let c = creator.commit_pending().unwrap();
    let welcome = c.welcome.clone().unwrap();
    assert_eq!(welcome_recipients(&welcome).unwrap(), info.reference);
    assert!(
        call.stage_commit(&c.commit, &[], 0).is_err(),
        "Welcome missing"
    );
    assert!(
        call.stage_commit(&c.commit, &welcome, 1).is_err(),
        "relayed by another member"
    );
    // Content and signature are checked; the confirmation and membership tags (the last 66 bytes) are MACs under keys
    // only members have, so a bad tag gets past the DS and is refused by the members (who then resync).
    for i in (0..c.commit.len() - 66).step_by(7) {
        let mut bad = c.commit.clone();
        bad[i] ^= 1;
        assert!(call.stage_commit(&bad, &welcome, 0).is_err(), "byte {i}");
    }
    assert_eq!(call.epoch(), 0, "refused commits leave no trace");
    let done = call.stage_commit(&c.commit, &welcome, 0).unwrap();
    assert_eq!(call.epoch(), 0, "staged, not merged yet");
    call.merge().unwrap();
    assert_eq!((done.epoch, done.sender_leaf), (1, 0));
    assert_eq!(done.added, info.reference);
    assert!(done.removed.is_empty());
    assert_eq!(creator.process(&c.commit).unwrap(), "commit");
    joiner.process_welcome(&welcome).unwrap();
    assert_eq!(call.members(), creator.members().unwrap());
    assert_eq!(call.members(), joiner.members().unwrap());
    let code = creator.epoch_authenticator().unwrap();
    assert_eq!(code, joiner.epoch_authenticator().unwrap());

    // Proposals by value (a member adding someone on its own) and proposals from another "DS" are refused.
    let rogue = joiner
        .add_members(&client(2).key_package().unwrap())
        .unwrap();
    assert!(
        call.stage_commit(&rogue.commit, &rogue.welcome.unwrap(), 1)
            .is_err()
    );
    joiner.clear_pending_commit().unwrap();
    let impostor = Client::new(DS_ID).unwrap();
    assert!(
        call.add_proposal(
            &impostor
                .external_propose_add(GID, 1, &client(3).key_package().unwrap())
                .unwrap()
        )
        .is_err()
    );

    // Remove: the DS names the leaf from its own view of the tree.
    let remove = ds.external_propose_remove(GID, 1, 1).unwrap();
    call.add_proposal(&remove).unwrap();
    let mut g = vec![creator, joiner];
    for m in g.iter_mut() {
        m.process(&remove).unwrap();
    }
    let c = g[0].commit_pending().unwrap();
    let done = call.stage_commit(&c.commit, &[], 0).unwrap();
    call.merge().unwrap();
    assert_eq!((done.epoch, done.removed.clone()), (2, vec![1]));
    assert_eq!(g[1].process(&c.commit).unwrap(), "removed");
    assert_eq!(g[0].process(&c.commit).unwrap(), "commit");
    assert_eq!(call.members(), g[0].members().unwrap());
    assert_ne!(g[0].epoch_authenticator().unwrap(), code);
    // An empty commit (no DS proposal) would only churn epochs: refused.
    let empty = g[0].commit_pending().unwrap();
    assert!(call.stage_commit(&empty.commit, &[], 0).is_err());
    assert!(call.merge().is_err(), "a refused commit is not staged");
}

/// Two members commit the same epoch: the DS orders one; the loser drops its own and follows the winner.
#[test]
fn losing_committer_clears_and_follows_the_winner() {
    let ds = Client::new(DS_ID).unwrap();
    let mut g = group_of(&ds, 3);
    let add = ds
        .external_propose_add(
            GID,
            g[0].epoch().unwrap(),
            &client(4).key_package().unwrap(),
        )
        .unwrap();
    for m in g.iter_mut() {
        m.process(&add).unwrap();
    }
    let winner = g[0].commit_pending().unwrap();
    let _loser = g[1].commit_pending().unwrap();
    g[1].clear_pending_commit().unwrap();
    for m in g.iter_mut() {
        assert_eq!(m.process(&winner.commit).unwrap(), "commit");
    }
    agreed(&mut g);
    // Without the clear, processing the winner also discards the pending commit (merge clears it).
    let add = ds
        .external_propose_add(
            GID,
            g[0].epoch().unwrap(),
            &client(5).key_package().unwrap(),
        )
        .unwrap();
    for m in g.iter_mut() {
        m.process(&add).unwrap();
    }
    let winner = g[0].commit_pending().unwrap();
    let _ = g[2].commit_pending().unwrap();
    for m in g.iter_mut() {
        assert_eq!(m.process(&winner.commit).unwrap(), "commit");
    }
    agreed(&mut g);
    g[2].leave().unwrap();
    assert!(g[2].epoch().is_err());
}

/// Canary for the upstream report (docs/security/upstream-openmls-issue.md): after a self-removal, OpenMLS 0.9.2 keeps
/// the removed member's last-epoch EncryptionKeyPairs even after `MlsGroup::delete`. `drop_group` wipes them; when this
/// test fails, upstream fixed it and the `shortcut:` in `drop_group` can go.
#[test]
fn upstream_delete_keeps_the_last_epoch_keypairs_of_a_removed_member() {
    let ds = Client::new(DS_ID).unwrap();
    let mut g = group_of(&ds, 3);
    let mut gone = g.pop().unwrap();
    let remove = ds
        .external_propose_remove(GID, g[0].epoch().unwrap(), gone.own_leaf_index().unwrap())
        .unwrap();
    let c = ds_epoch(&mut g, &remove);
    assert_eq!(gone.process(&remove).unwrap(), "proposal");

    // What the wrapper's `process` does, minus its wipe: process, merge the self-removal, delete the group.
    let mut group = gone.group.take().unwrap();
    let msg = MlsMessageIn::tls_deserialize_exact(&c.commit)
        .unwrap()
        .try_into_protocol_message()
        .unwrap();
    let ProcessedMessageContent::StagedCommitMessage(staged) = group
        .process_message(&gone.provider, msg)
        .unwrap()
        .into_content()
    else {
        panic!("not a commit")
    };
    assert!(staged.self_removed());
    group.merge_staged_commit(&gone.provider, *staged).unwrap();
    group.delete(gone.provider.storage()).unwrap();
    let left: Vec<_> = gone
        .provider
        .storage()
        .values
        .read()
        .unwrap()
        .keys()
        .filter(|k| k.starts_with(b"EpochKeyPairs"))
        .cloned()
        .collect();
    assert!(!left.is_empty(), "upstream now deletes them: drop the shortcut in drop_group");
}
