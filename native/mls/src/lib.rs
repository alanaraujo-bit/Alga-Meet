//! Alga Meet E2EE: thin wasm-bindgen wrapper over OpenMLS (docs/decisions/0004-e2ee.md §2.2, §3).
//!
//! One `Client` = one device signature identity plus at most one call group. The same type plays the
//! Delivery Service role (`external_propose_*`): the gateway is the group's only external sender.
//! Every MLS message crosses this boundary as TLS-serialized `MLSMessage` bytes. Errors are thrown as strings.

use openmls::prelude::tls_codec::{Deserialize as _, Serialize as _};
use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;
use wasm_bindgen::prelude::*;

/// Ciphersuite 1, the RFC 9420 mandatory one (0004 §2.2).
const CS: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;
const IDENTITY_MAGIC: &[u8] = b"AMI1";
const STATE_MAGIC: &[u8] = b"AMS1";

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn ser(m: impl Into<MlsMessageOut>) -> Result<Vec<u8>, String> {
    m.into().tls_serialize_detached().map_err(err)
}

fn de(bytes: &[u8]) -> Result<MlsMessageBodyIn, String> {
    Ok(MlsMessageIn::tls_deserialize_exact(bytes)
        .map_err(err)?
        .extract())
}

// Length-prefixed (u32 BE) fields: the host encrypts these blobs at rest (DPAPI), so the format only needs to be stable.
fn put(out: &mut Vec<u8>, b: &[u8]) {
    out.extend_from_slice(&(b.len() as u32).to_be_bytes());
    out.extend_from_slice(b);
}

fn take<'a>(input: &mut &'a [u8]) -> Result<&'a [u8], String> {
    let (len, rest) = input.split_at_checked(4).ok_or("truncated state")?;
    let n = u32::from_be_bytes(len.try_into().unwrap()) as usize;
    let (v, rest) = rest.split_at_checked(n).ok_or("truncated state")?;
    *input = rest;
    Ok(v)
}

fn magic(input: &mut &[u8], m: &[u8]) -> Result<(), String> {
    let (head, rest) = input.split_at_checked(m.len()).ok_or("truncated state")?;
    if head != m {
        return Err("unknown state format".into());
    }
    *input = rest;
    Ok(())
}

#[wasm_bindgen(getter_with_clone)]
pub struct Commit {
    /// Commit as a PublicMessage (the DS reads it to check the proposals it covers).
    pub commit: Vec<u8>,
    /// Welcome for the members it adds, if any (carries the ratchet tree).
    pub welcome: Option<Vec<u8>>,
}

#[wasm_bindgen]
pub struct Client {
    provider: OpenMlsRustCrypto,
    identity: Vec<u8>,
    /// Raw Ed25519 private key (SignatureKeyPair only exposes it under test-utils).
    private: Vec<u8>,
    signer: SignatureKeyPair,
    group: Option<MlsGroup>,
}

#[wasm_bindgen]
impl Client {
    /// New Ed25519 identity; `identity` is the BasicCredential content (`userId:deviceId`).
    #[wasm_bindgen(constructor)]
    pub fn new(identity: &[u8]) -> Result<Client, String> {
        let provider = OpenMlsRustCrypto::default();
        let (private, public) = provider
            .crypto()
            .signature_key_gen(CS.signature_algorithm())
            .map_err(err)?;
        Ok(Self::with(identity.to_vec(), private, public))
    }

    /// Client (no group) from a blob made by `export_identity`.
    pub fn from_identity(blob: &[u8]) -> Result<Client, String> {
        let mut input = blob;
        magic(&mut input, IDENTITY_MAGIC)?;
        let identity = take(&mut input)?.to_vec();
        let private = take(&mut input)?.to_vec();
        let public = take(&mut input)?.to_vec();
        if !input.is_empty() || private.len() != 32 || public.len() != 32 {
            return Err("malformed identity".into());
        }
        Ok(Self::with(identity, private, public))
    }

    fn with(identity: Vec<u8>, private: Vec<u8>, public: Vec<u8>) -> Client {
        let signer = SignatureKeyPair::from_raw(CS.signature_algorithm(), private.clone(), public);
        Client {
            provider: OpenMlsRustCrypto::default(),
            identity,
            private,
            signer,
            group: None,
        }
    }

    fn credential(&self) -> CredentialWithKey {
        CredentialWithKey {
            credential: BasicCredential::new(self.identity.clone()).into(),
            signature_key: self.signer.public().into(),
        }
    }

    /// A client holds one group: a new call (or re-entry into the same one, 0004 §3.6) discards the old state.
    fn drop_group(&mut self) -> Result<(), String> {
        let Some(mut g) = self.group.take() else {
            return Ok(());
        };
        g.delete(self.provider.storage()).map_err(err)?;
        // shortcut: MlsGroup::delete misses a removed member's last-epoch HPKE keys (forward secrecy). We hold one
        // group, so every EpochKeyPairs entry is stale. Relies on memory storage's "label ‖ key" layout (pinned 0.6.0).
        self.provider
            .storage()
            .values
            .write()
            .unwrap()
            .retain(|k, _| !k.starts_with(b"EpochKeyPairs"));
        Ok(())
    }

    /// Long-lived device identity (contains the private signature key: the host must encrypt it at rest).
    pub fn export_identity(&self) -> Vec<u8> {
        let mut out = IDENTITY_MAGIC.to_vec();
        put(&mut out, &self.identity);
        put(&mut out, &self.private);
        put(&mut out, self.signer.public());
        out
    }

    pub fn signature_public_key(&self) -> Vec<u8> {
        self.signer.public().to_vec()
    }

    /// Full state (identity + OpenMLS storage + current group id). Deterministic: storage entries sorted by key.
    pub fn save_state(&self) -> Vec<u8> {
        let mut out = STATE_MAGIC.to_vec();
        put(&mut out, &self.export_identity());
        put(
            &mut out,
            self.group
                .as_ref()
                .map_or(&[][..], |g| g.group_id().as_slice()),
        );
        let values = self.provider.storage().values.read().unwrap();
        let mut entries: Vec<_> = values.iter().collect();
        entries.sort();
        for (k, v) in entries {
            put(&mut out, k);
            put(&mut out, v);
        }
        out
    }

    pub fn load_state(blob: &[u8]) -> Result<Client, String> {
        let mut input = blob;
        magic(&mut input, STATE_MAGIC)?;
        let mut client = Client::from_identity(take(&mut input)?)?;
        let group_id = take(&mut input)?.to_vec();
        {
            let mut values = client.provider.storage().values.write().unwrap();
            while !input.is_empty() {
                let k = take(&mut input)?.to_vec();
                values.insert(k, take(&mut input)?.to_vec());
            }
        }
        if !group_id.is_empty() {
            let group = MlsGroup::load(client.provider.storage(), &GroupId::from_slice(&group_id))
                .map_err(err)?;
            client.group = Some(group.ok_or("group missing from state")?);
        }
        Ok(client)
    }

    /// One-time key package (fresh HPKE init key) to send with `POST /voice/join`.
    pub fn key_package(&self) -> Result<Vec<u8>, String> {
        let bundle = KeyPackage::builder()
            .build(CS, &self.provider, &self.signer, self.credential())
            .map_err(err)?;
        ser(bundle.key_package().clone())
    }

    /// Epoch 1 of an empty call, with the DS as the single external sender (0004 §3.4.1).
    pub fn create_group(
        &mut self,
        group_id: &[u8],
        ds_public_key: &[u8],
        ds_identity: &[u8],
    ) -> Result<(), String> {
        let ds = ExternalSender::new(
            ds_public_key.into(),
            BasicCredential::new(ds_identity.to_vec()).into(),
        );
        let config = MlsGroupCreateConfig::builder()
            .ciphersuite(CS)
            .wire_format_policy(PURE_PLAINTEXT_WIRE_FORMAT_POLICY)
            .use_ratchet_tree_extension(true)
            .with_group_context_extensions(
                Extensions::single(Extension::ExternalSenders(vec![ds])).map_err(err)?,
            )
            .build();
        self.drop_group()?;
        let group = MlsGroup::new_with_group_id(
            &self.provider,
            &self.signer,
            &config,
            GroupId::from_slice(group_id),
            self.credential(),
        )
        .map_err(err)?;
        self.group = Some(group);
        Ok(())
    }

    pub fn process_welcome(&mut self, welcome: &[u8]) -> Result<(), String> {
        let MlsMessageBodyIn::Welcome(welcome) = de(welcome)? else {
            return Err("not a welcome".into());
        };
        let config = MlsGroupJoinConfig::builder()
            .wire_format_policy(PURE_PLAINTEXT_WIRE_FORMAT_POLICY)
            .use_ratchet_tree_extension(true)
            .build();
        self.drop_group()?;
        let group = StagedWelcome::new_from_welcome(&self.provider, &config, welcome, None)
            .map_err(err)?
            .into_group(&self.provider)
            .map_err(err)?;
        self.group = Some(group);
        Ok(())
    }

    /// Member-initiated Add of `key_packages` (concatenated MLSMessage(KeyPackage) bytes). Leaves a pending commit.
    pub fn add_members(&mut self, key_packages: &[u8]) -> Result<Commit, String> {
        let mut input = key_packages;
        let mut kps = Vec::new();
        while !input.is_empty() {
            let MlsMessageBodyIn::KeyPackage(kp) = MlsMessageIn::tls_deserialize(&mut input)
                .map_err(err)?
                .extract()
            else {
                return Err("not a key package".into());
            };
            kps.push(
                kp.validate(self.provider.crypto(), ProtocolVersion::Mls10)
                    .map_err(err)?,
            );
        }
        let (provider, signer) = (&self.provider, &self.signer);
        let group = self.group.as_mut().ok_or("no group")?;
        let (commit, welcome, _) = group.add_members(provider, signer, &kps).map_err(err)?;
        Ok(Commit {
            commit: ser(commit)?,
            welcome: Some(ser(welcome)?),
        })
    }

    /// Member-initiated Remove by leaf index. Leaves a pending commit.
    pub fn remove_members(&mut self, leaf_indices: Vec<u32>) -> Result<Commit, String> {
        let leaves: Vec<_> = leaf_indices.into_iter().map(LeafNodeIndex::new).collect();
        let (provider, signer) = (&self.provider, &self.signer);
        let group = self.group.as_mut().ok_or("no group")?;
        let (commit, welcome, _) = group
            .remove_members(provider, signer, &leaves)
            .map_err(err)?;
        Ok(Commit {
            commit: ser(commit)?,
            welcome: welcome.map(ser).transpose()?,
        })
    }

    /// Committer: commit every proposal received from the DS. Leaves a pending commit.
    pub fn commit_pending(&mut self) -> Result<Commit, String> {
        let (provider, signer) = (&self.provider, &self.signer);
        let group = self.group.as_mut().ok_or("no group")?;
        let (commit, welcome, _) = group
            .commit_to_pending_proposals(provider, signer)
            .map_err(err)?;
        Ok(Commit {
            commit: ser(commit)?,
            welcome: welcome.map(ser).transpose()?,
        })
    }

    /// Apply our own pending commit once the DS accepted it.
    pub fn merge_pending_commit(&mut self) -> Result<(), String> {
        let provider = &self.provider;
        self.group
            .as_mut()
            .ok_or("no group")?
            .merge_pending_commit(provider)
            .map_err(err)
    }

    /// Handshake from the gateway. Returns "proposal" (queued), "commit" (merged: new epoch) or "removed"
    /// (we are out: the group is gone). Proposals are accepted only from the DS (external sender 0).
    pub fn process(&mut self, message: &[u8]) -> Result<String, String> {
        let message = MlsMessageIn::tls_deserialize_exact(message)
            .map_err(err)?
            .try_into_protocol_message()
            .map_err(err)?;
        let provider = &self.provider;
        let group = self.group.as_mut().ok_or("no group")?;
        let processed = group.process_message(provider, message).map_err(err)?;
        let from_ds = *processed.sender() == Sender::External(SenderExtensionIndex::new(0));
        match processed.into_content() {
            ProcessedMessageContent::ProposalMessage(p) if from_ds => {
                group
                    .store_pending_proposal(provider.storage(), *p)
                    .map_err(err)?;
                Ok("proposal".into())
            }
            ProcessedMessageContent::StagedCommitMessage(c) => {
                let removed = c.self_removed();
                group.merge_staged_commit(provider, *c).map_err(err)?;
                if removed {
                    self.drop_group()?;
                    return Ok("removed".into());
                }
                Ok("commit".into())
            }
            ProcessedMessageContent::OwnPendingCommit => {
                group.merge_pending_commit(provider).map_err(err)?;
                Ok("commit".into())
            }
            _ => Err("unexpected message (only DS proposals and commits are accepted)".into()),
        }
    }

    pub fn epoch(&self) -> Result<u64, String> {
        Ok(self.group.as_ref().ok_or("no group")?.epoch().as_u64())
    }

    pub fn own_leaf_index(&self) -> Result<u32, String> {
        Ok(self
            .group
            .as_ref()
            .ok_or("no group")?
            .own_leaf_index()
            .u32())
    }

    /// MLS-Exporter of the current epoch (0004 §3.6: per-sender media key base).
    pub fn export_secret(
        &self,
        label: &str,
        context: &[u8],
        len: usize,
    ) -> Result<Vec<u8>, String> {
        let group = self.group.as_ref().ok_or("no group")?;
        group
            .export_secret(self.provider.crypto(), label, context, len)
            .map_err(err)
    }

    /// DS role: external Add proposal for `key_package` in `group_id` at `epoch`, signed with this identity.
    pub fn external_propose_add(
        &self,
        group_id: &[u8],
        epoch: u64,
        key_package: &[u8],
    ) -> Result<Vec<u8>, String> {
        let MlsMessageBodyIn::KeyPackage(kp) = de(key_package)? else {
            return Err("not a key package".into());
        };
        let kp = kp
            .validate(self.provider.crypto(), ProtocolVersion::Mls10)
            .map_err(err)?;
        let msg = ExternalProposal::new_add::<OpenMlsRustCrypto>(
            kp,
            GroupId::from_slice(group_id),
            epoch.into(),
            &self.signer,
            SenderExtensionIndex::new(0),
        )
        .map_err(err)?;
        ser(msg)
    }

    /// DS role: external Remove proposal for `leaf_index` in `group_id` at `epoch`.
    pub fn external_propose_remove(
        &self,
        group_id: &[u8],
        epoch: u64,
        leaf_index: u32,
    ) -> Result<Vec<u8>, String> {
        let msg = ExternalProposal::new_remove::<OpenMlsRustCrypto>(
            LeafNodeIndex::new(leaf_index),
            GroupId::from_slice(group_id),
            epoch.into(),
            &self.signer,
            SenderExtensionIndex::new(0),
        )
        .map_err(err)?;
        ser(msg)
    }
}

#[cfg(test)]
mod tests;
