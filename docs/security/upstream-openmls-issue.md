# Upstream report for OpenMLS (draft, not submitted)

Found during Alga Meet's E2EE phase 0 (`docs/decisions/0004-e2ee.md` §9, item 6). **Nothing was posted.** The text
below is ready for the owner to file at <https://github.com/openmls/openmls/issues> (or privately first, through
the project's security contact, if they prefer to treat a forward-secrecy gap as a vulnerability).

Local workaround: `native/mls/src/lib.rs`, `drop_group` (`shortcut:` comment) wipes every `EpochKeyPairs` entry.
Canary: `native/mls/src/tests.rs`, `upstream_delete_keeps_the_last_epoch_keypairs_of_a_removed_member`, fails
once upstream deletes them, so the workaround can go.

---

**Title:** Removed member keeps its last epoch's `EncryptionKeyPair`s after `merge_staged_commit` + `MlsGroup::delete`

**Version:** `openmls` 0.9.2, `openmls_rust_crypto` 0.6.0, `openmls_memory_storage` 0.6.0 (ciphersuite
`MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`). Native and `wasm32-unknown-unknown`.

**What happens**

A member that processes a Commit removing it gets a `StagedCommit` with `self_removed() == true`. Merging it goes
through the `StagedCommitState::PublicState` branch of `MlsGroup::merge_commit`
(`group/mls_group/staged_commit.rs`): the public tree is updated and the group is stored, but the encryption key
pairs of the epoch it was removed from are never deleted. (`old_epoch_keypairs` is read at the top of
`merge_commit` and only used in the `GroupMember` branch.)

`MlsGroup::delete` then calls `delete_encryption_epoch_key_pairs(group_id, &self.epoch(), own_leaf_index)`, i.e.
for the epoch *after* the removal, where nothing is stored. The `EpochKeyPairs` entry of the last epoch the client
was a member of (its leaf HPKE key pair and the key pairs of its direct path) stays in the storage provider for good.

**Why it matters**

Forward secrecy in MLS rests on deleting private keys once they are no longer needed (RFC 9420, security
considerations on forward and post-compromise security). A client that was removed and then deleted the group, as
the docs suggest, still holds the private HPKE keys of its leaf and direct path. If the device is compromised
later, those keys decrypt the UpdatePath ciphertexts it received while it was a member, i.e. path secrets of past
epochs. On their own they do not yield an epoch secret (that also needs the previous init secret), but they are key
material the protocol expects to be gone, and they turn any other leaked secret of that group into more past
epochs. The application cannot clean up without reaching into the storage provider's key layout.

**Reproduction** (inside a crate that depends on `openmls` + `openmls_rust_crypto`; condensed from our canary test)

1. Create a group of 3 members (A creates; B and C are added with an external sender's Add proposals, or with
   `add_members`, it does not matter).
2. A commits a Remove of C's leaf; every member processes it.
3. On C: `process_message(commit)` → `StagedCommitMessage(staged)`, `staged.self_removed() == true` →
   `merge_staged_commit(provider, *staged)` → `group.delete(provider.storage())`.
4. Inspect the storage: `provider.storage().encryption_epoch_key_pairs(&group_id, &GroupEpoch::from(n), leaf)` for
   the removal epoch `n` and C's leaf index is still non-empty (with `MemoryStorage`, keys labelled `EpochKeyPairs`
   remain in `values`).

**Expected**

After a self-removal is merged (or at the latest in `MlsGroup::delete`), no `EncryptionKeyPair` of the group is left
in storage: delete the previous epoch's key pairs in the `PublicState` merge path when `self_removed`, and/or make
`delete` remove the key pairs of every epoch it may have stored for the group (at least the current and the
previous one).

**Workaround we use**

The client holds a single group, so after `delete` it removes every storage entry whose key starts with
`EpochKeyPairs`. This depends on `openmls_memory_storage`'s internal key layout, which is why we would rather see it
fixed upstream.
