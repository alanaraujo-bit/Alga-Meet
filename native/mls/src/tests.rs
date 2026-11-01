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
