/* tslint:disable */
/* eslint-disable */

export class Client {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Member-initiated Add of `key_packages` (concatenated MLSMessage(KeyPackage) bytes). Leaves a pending commit.
     */
    add_members(key_packages: Uint8Array | number[]): Commit;
    /**
     * Our commit lost (the DS ordered another one, or refused it): forget it so the next commit can be built.
     */
    clear_pending_commit(): void;
    /**
     * Committer: commit every proposal received from the DS. Leaves a pending commit.
     */
    commit_pending(): Commit;
    /**
     * Epoch 1 of an empty call, with the DS as the single external sender (0004 §3.4.1).
     */
    create_group(group_id: Uint8Array | number[], ds_public_key: Uint8Array | number[], ds_identity: Uint8Array | number[]): void;
    /**
     * Epoch authenticator (32 bytes): the same for every member of this epoch, so it is the call verification code.
     */
    epoch_authenticator(): Uint8Array;
    epoch(): bigint;
    /**
     * Long-lived device identity (contains the private signature key: the host must encrypt it at rest).
     */
    export_identity(): Uint8Array;
    /**
     * MLS-Exporter of the current epoch (0004 §3.6: per-sender media key base).
     */
    export_secret(label: string, context: Uint8Array | number[], len: number): Uint8Array;
    /**
     * DS role: external Add proposal for `key_package` in `group_id` at `epoch`, signed with this identity.
     */
    external_propose_add(group_id: Uint8Array | number[], epoch: bigint, key_package: Uint8Array | number[]): Uint8Array;
    /**
     * DS role: external Remove proposal for `leaf_index` in `group_id` at `epoch`.
     */
    external_propose_remove(group_id: Uint8Array | number[], epoch: bigint, leaf_index: number): Uint8Array;
    /**
     * Client (no group) from a blob made by `export_identity`.
     */
    static from_identity(blob: Uint8Array | number[]): Client;
    /**
     * Creator: GroupInfo with the ratchet tree, for the DS to start tracking the public state (`PublicCall`).
     */
    group_info(): Uint8Array;
    /**
     * One-time key package (fresh HPKE init key) to send with `POST /voice/join`.
     */
    key_package(): Uint8Array;
    /**
     * Leaving the call: drop the group and its keys (key packages of the device stay).
     */
    leave(): void;
    static load_state(blob: Uint8Array | number[]): Client;
    /**
     * Current members, from MLS (0004 §3.8: the "in this encrypted call" list never comes from the server).
     */
    members(): string;
    /**
     * Apply our own pending commit once the DS accepted it.
     */
    merge_pending_commit(): void;
    /**
     * New Ed25519 identity; `identity` is the BasicCredential content (`userId:deviceId`).
     */
    constructor(identity: Uint8Array | number[]);
    own_leaf_index(): number;
    /**
     * Handshake from the gateway. Returns "proposal" (queued), "commit" (merged: new epoch) or "removed"
     * (we are out: the group is gone). Proposals are accepted only from the DS (external sender 0).
     */
    process(message: Uint8Array | number[]): string;
    process_welcome(welcome: Uint8Array | number[]): void;
    /**
     * Member-initiated Remove by leaf index. Leaves a pending commit.
     */
    remove_members(leaf_indices: Uint32Array | number[]): Commit;
    /**
     * Full state (identity + OpenMLS storage + current group id). Deterministic: storage entries sorted by key.
     */
    save_state(): Uint8Array;
    signature_public_key(): Uint8Array;
}

export class Commit {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Commit as a PublicMessage (the DS reads it to check the proposals it covers).
     */
    get commit(): Uint8Array;
    /**
     * Commit as a PublicMessage (the DS reads it to check the proposals it covers).
     */
    set commit(value: Uint8Array | number[]);
    /**
     * Welcome for the members it adds, if any (carries the ratchet tree).
     */
    get welcome(): Uint8Array | undefined;
    /**
     * Welcome for the members it adds, if any (carries the ratchet tree).
     */
    set welcome(value: Uint8Array | number[] | null | undefined);
}

export class CommitInfo {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * KeyPackageRefs of the members it added, in commit order (32 bytes each, concatenated).
     */
    get added(): Uint8Array;
    /**
     * KeyPackageRefs of the members it added, in commit order (32 bytes each, concatenated).
     */
    set added(value: Uint8Array | number[]);
    /**
     * Epoch the group moved to.
     */
    epoch: bigint;
    /**
     * Leaf indices it removed.
     */
    get removed(): Uint32Array;
    /**
     * Leaf indices it removed.
     */
    set removed(value: Uint32Array | number[]);
    sender_leaf: number;
}

export class KeyPackageInfo {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * BasicCredential content (`userId:deviceId`).
     */
    get identity(): Uint8Array;
    /**
     * BasicCredential content (`userId:deviceId`).
     */
    set identity(value: Uint8Array | number[]);
    /**
     * End of the key package lifetime, seconds since the Unix epoch.
     */
    not_after: bigint;
    /**
     * KeyPackageRef (RFC 9420 §5.2): how a Welcome names its recipients.
     */
    get reference(): Uint8Array;
    /**
     * KeyPackageRef (RFC 9420 §5.2): how a Welcome names its recipients.
     */
    set reference(value: Uint8Array | number[]);
    /**
     * Leaf Ed25519 public key (the device identity key).
     */
    get signature_key(): Uint8Array;
    /**
     * Leaf Ed25519 public key (the device identity key).
     */
    set signature_key(value: Uint8Array | number[]);
}

/**
 * DS view of one call (0004 §3.3): OpenMLS `PublicGroup`, the group's public state (tree, context) without any
 * secret. Lets the server check every commit against the real tree before relaying it, and name leaves for Removes.
 */
export class PublicCall {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * A proposal the DS just signed for this epoch: validated against the public state and queued.
     */
    add_proposal(message: Uint8Array | number[]): void;
    discard(): void;
    epoch(): bigint;
    /**
     * From the creator's GroupInfo (MLSMessage, with the ratchet_tree extension): verifies tree and signature.
     */
    static from_group_info(group_info: Uint8Array | number[]): PublicCall;
    group_id(): Uint8Array;
    /**
     * True when the group's only external sender is this DS key + identity (else its proposals would not apply).
     */
    has_external_sender(ds_public_key: Uint8Array | number[], ds_identity: Uint8Array | number[]): boolean;
    members(): string;
    /**
     * Apply the staged commit: the DS ordered it.
     */
    merge(): void;
    /**
     * A member's commit for this epoch, from leaf `sender`: verified against the public state (signature, tree,
     * proposals) and held until `merge`/`discard`. It must cover only queued DS proposals (by reference), may not change
     * the committer's identity, and `welcome` must be encrypted to exactly the added key packages (empty when it adds
     * nobody). The confirmation and membership tags are MACs only members can check.
     */
    stage_commit(commit: Uint8Array | number[], welcome: Uint8Array | number[], sender: number): CommitInfo;
}

/**
 * DS: validates an uploaded key package (exact parse, signatures, ciphersuite 1, lifetime, basic credential).
 */
export function inspect_key_package(bytes: Uint8Array | number[]): KeyPackageInfo;

/**
 * DS: KeyPackageRefs a Welcome is encrypted to (32 bytes each, concatenated).
 */
export function welcome_recipients(welcome: Uint8Array | number[]): Uint8Array;
