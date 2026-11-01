/* @ts-self-types="./alga_mls.d.ts" */

class Client {
    static __wrap(ptr) {
        const obj = Object.create(Client.prototype);
        obj.__wbg_ptr = ptr;
        ClientFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ClientFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_client_free(ptr, 0);
    }
    /**
     * Member-initiated Add of `key_packages` (concatenated MLSMessage(KeyPackage) bytes). Leaves a pending commit.
     * @param {Uint8Array | number[]} key_packages
     * @returns {Commit}
     */
    add_members(key_packages) {
        const ptr0 = passArray8ToWasm0(key_packages, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.client_add_members(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Commit.__wrap(ret[0]);
    }
    /**
     * Our commit lost (the DS ordered another one, or refused it): forget it so the next commit can be built.
     */
    clear_pending_commit() {
        const ret = wasm.client_clear_pending_commit(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Committer: commit every proposal received from the DS. Leaves a pending commit.
     * @returns {Commit}
     */
    commit_pending() {
        const ret = wasm.client_commit_pending(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Commit.__wrap(ret[0]);
    }
    /**
     * Epoch 1 of an empty call, with the DS as the single external sender (0004 §3.4.1).
     * @param {Uint8Array | number[]} group_id
     * @param {Uint8Array | number[]} ds_public_key
     * @param {Uint8Array | number[]} ds_identity
     */
    create_group(group_id, ds_public_key, ds_identity) {
        let ptr0, len0, ptr1, len1, ptr2, len2;
        try {
            ptr0 = passArray8ToWasm0(group_id, wasm.__wbindgen_malloc);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passArray8ToWasm0(ds_public_key, wasm.__wbindgen_malloc);
            len1 = WASM_VECTOR_LEN;
            ptr2 = passArray8ToWasm0(ds_identity, wasm.__wbindgen_malloc);
            len2 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr2) { wasm.__wbindgen_free(ptr2, len2 * 1, 1); }
            if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
            throw e;
        }
        const ret = wasm.client_create_group(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Epoch authenticator (32 bytes): the same for every member of this epoch, so it is the call verification code.
     * @returns {Uint8Array}
     */
    epoch_authenticator() {
        const ret = wasm.client_epoch_authenticator(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @returns {bigint}
     */
    epoch() {
        const ret = wasm.client_epoch(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return BigInt.asUintN(64, ret[0]);
    }
    /**
     * Long-lived device identity (contains the private signature key: the host must encrypt it at rest).
     * @returns {Uint8Array}
     */
    export_identity() {
        const ret = wasm.client_export_identity(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * MLS-Exporter of the current epoch (0004 §3.6: per-sender media key base).
     * @param {string} label
     * @param {Uint8Array | number[]} context
     * @param {number} len
     * @returns {Uint8Array}
     */
    export_secret(label, context, len) {
        const val3 = +len;
        let ptr0, len0, ptr1, len1;
        try {
            ptr0 = passStringToWasm0(label, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passArray8ToWasm0(context, wasm.__wbindgen_malloc);
            len1 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
            throw e;
        }
        const ret = wasm.client_export_secret(this.__wbg_ptr, ptr0, len0, ptr1, len1, val3);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v4 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v4;
    }
    /**
     * DS role: external Add proposal for `key_package` in `group_id` at `epoch`, signed with this identity.
     * @param {Uint8Array | number[]} group_id
     * @param {bigint} epoch
     * @param {Uint8Array | number[]} key_package
     * @returns {Uint8Array}
     */
    external_propose_add(group_id, epoch, key_package) {
        const val3 = BigInt.asIntN(64, epoch);
        let ptr0, len0, ptr1, len1;
        try {
            ptr0 = passArray8ToWasm0(group_id, wasm.__wbindgen_malloc);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passArray8ToWasm0(key_package, wasm.__wbindgen_malloc);
            len1 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
            throw e;
        }
        const ret = wasm.client_external_propose_add(this.__wbg_ptr, ptr0, len0, val3, ptr1, len1);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v4 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v4;
    }
    /**
     * DS role: external Remove proposal for `leaf_index` in `group_id` at `epoch`.
     * @param {Uint8Array | number[]} group_id
     * @param {bigint} epoch
     * @param {number} leaf_index
     * @returns {Uint8Array}
     */
    external_propose_remove(group_id, epoch, leaf_index) {
        const val2 = BigInt.asIntN(64, epoch);
        const val3 = +leaf_index;
        const ptr0 = passArray8ToWasm0(group_id, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.client_external_propose_remove(this.__wbg_ptr, ptr0, len0, val2, val3);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v4 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v4;
    }
    /**
     * Client (no group) from a blob made by `export_identity`.
     * @param {Uint8Array | number[]} blob
     * @returns {Client}
     */
    static from_identity(blob) {
        const ptr0 = passArray8ToWasm0(blob, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.client_from_identity(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Client.__wrap(ret[0]);
    }
    /**
     * Creator: GroupInfo with the ratchet tree, for the DS to start tracking the public state (`PublicCall`).
     * @returns {Uint8Array}
     */
    group_info() {
        const ret = wasm.client_group_info(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * One-time key package (fresh HPKE init key) to send with `POST /voice/join`.
     * @returns {Uint8Array}
     */
    key_package() {
        const ret = wasm.client_key_package(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Leaving the call: drop the group and its keys (key packages of the device stay).
     */
    leave() {
        const ret = wasm.client_leave(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {Uint8Array | number[]} blob
     * @returns {Client}
     */
    static load_state(blob) {
        const ptr0 = passArray8ToWasm0(blob, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.client_load_state(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Client.__wrap(ret[0]);
    }
    /**
     * Current members, from MLS (0004 §3.8: the "in this encrypted call" list never comes from the server).
     * @returns {string}
     */
    members() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.client_members(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Apply our own pending commit once the DS accepted it.
     */
    merge_pending_commit() {
        const ret = wasm.client_merge_pending_commit(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * New Ed25519 identity; `identity` is the BasicCredential content (`userId:deviceId`).
     * @param {Uint8Array | number[]} identity
     */
    constructor(identity) {
        const ptr0 = passArray8ToWasm0(identity, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.client_new(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        ClientFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {number}
     */
    own_leaf_index() {
        const ret = wasm.client_own_leaf_index(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * Handshake from the gateway. Returns "proposal" (queued), "commit" (merged: new epoch) or "removed"
     * (we are out: the group is gone). Proposals are accepted only from the DS (external sender 0).
     * @param {Uint8Array | number[]} message
     * @returns {string}
     */
    process(message) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passArray8ToWasm0(message, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.client_process(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * @param {Uint8Array | number[]} welcome
     */
    process_welcome(welcome) {
        const ptr0 = passArray8ToWasm0(welcome, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.client_process_welcome(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Member-initiated Remove by leaf index. Leaves a pending commit.
     * @param {Uint32Array | number[]} leaf_indices
     * @returns {Commit}
     */
    remove_members(leaf_indices) {
        const ptr0 = passArray32ToWasm0(leaf_indices, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.client_remove_members(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Commit.__wrap(ret[0]);
    }
    /**
     * Full state (identity + OpenMLS storage + current group id). Deterministic: storage entries sorted by key.
     * @returns {Uint8Array}
     */
    save_state() {
        const ret = wasm.client_save_state(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @returns {Uint8Array}
     */
    signature_public_key() {
        const ret = wasm.client_signature_public_key(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
}
if (Symbol.dispose) Client.prototype[Symbol.dispose] = Client.prototype.free;
exports.Client = Client;

class Commit {
    static __wrap(ptr) {
        const obj = Object.create(Commit.prototype);
        obj.__wbg_ptr = ptr;
        CommitFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        CommitFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_commit_free(ptr, 0);
    }
    /**
     * Commit as a PublicMessage (the DS reads it to check the proposals it covers).
     * @returns {Uint8Array}
     */
    get commit() {
        const ret = wasm.__wbg_get_commit_commit(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Welcome for the members it adds, if any (carries the ratchet tree).
     * @returns {Uint8Array | undefined}
     */
    get welcome() {
        const ret = wasm.__wbg_get_commit_welcome(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * Commit as a PublicMessage (the DS reads it to check the proposals it covers).
     * @param {Uint8Array | number[]} arg0
     */
    set commit(arg0) {
        const ptr0 = passArray8ToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_commit_commit(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Welcome for the members it adds, if any (carries the ratchet tree).
     * @param {Uint8Array | number[] | null} [arg0]
     */
    set welcome(arg0) {
        var ptr0 = isLikeNone(arg0) ? 0 : passArray8ToWasm0(arg0, wasm.__wbindgen_malloc);
        var len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_commit_welcome(this.__wbg_ptr, ptr0, len0);
    }
}
if (Symbol.dispose) Commit.prototype[Symbol.dispose] = Commit.prototype.free;
exports.Commit = Commit;

class CommitInfo {
    static __wrap(ptr) {
        const obj = Object.create(CommitInfo.prototype);
        obj.__wbg_ptr = ptr;
        CommitInfoFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        CommitInfoFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_commitinfo_free(ptr, 0);
    }
    /**
     * KeyPackageRefs of the members it added, in commit order (32 bytes each, concatenated).
     * @returns {Uint8Array}
     */
    get added() {
        const ret = wasm.__wbg_get_commitinfo_added(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Epoch the group moved to.
     * @returns {bigint}
     */
    get epoch() {
        const ret = wasm.__wbg_get_commitinfo_epoch(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * Leaf indices it removed.
     * @returns {Uint32Array}
     */
    get removed() {
        const ret = wasm.__wbg_get_commitinfo_removed(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {number}
     */
    get sender_leaf() {
        const ret = wasm.__wbg_get_commitinfo_sender_leaf(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * KeyPackageRefs of the members it added, in commit order (32 bytes each, concatenated).
     * @param {Uint8Array | number[]} arg0
     */
    set added(arg0) {
        const ptr0 = passArray8ToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_commitinfo_added(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Epoch the group moved to.
     * @param {bigint} arg0
     */
    set epoch(arg0) {
        wasm.__wbg_set_commitinfo_epoch(this.__wbg_ptr, arg0);
    }
    /**
     * Leaf indices it removed.
     * @param {Uint32Array | number[]} arg0
     */
    set removed(arg0) {
        const ptr0 = passArray32ToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_commitinfo_removed(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {number} arg0
     */
    set sender_leaf(arg0) {
        wasm.__wbg_set_commitinfo_sender_leaf(this.__wbg_ptr, arg0);
    }
}
if (Symbol.dispose) CommitInfo.prototype[Symbol.dispose] = CommitInfo.prototype.free;
exports.CommitInfo = CommitInfo;

class KeyPackageInfo {
    static __wrap(ptr) {
        const obj = Object.create(KeyPackageInfo.prototype);
        obj.__wbg_ptr = ptr;
        KeyPackageInfoFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        KeyPackageInfoFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_keypackageinfo_free(ptr, 0);
    }
    /**
     * BasicCredential content (`userId:deviceId`).
     * @returns {Uint8Array}
     */
    get identity() {
        const ret = wasm.__wbg_get_keypackageinfo_identity(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * End of the key package lifetime, seconds since the Unix epoch.
     * @returns {bigint}
     */
    get not_after() {
        const ret = wasm.__wbg_get_keypackageinfo_not_after(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * KeyPackageRef (RFC 9420 §5.2): how a Welcome names its recipients.
     * @returns {Uint8Array}
     */
    get reference() {
        const ret = wasm.__wbg_get_keypackageinfo_reference(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Leaf Ed25519 public key (the device identity key).
     * @returns {Uint8Array}
     */
    get signature_key() {
        const ret = wasm.__wbg_get_keypackageinfo_signature_key(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * BasicCredential content (`userId:deviceId`).
     * @param {Uint8Array | number[]} arg0
     */
    set identity(arg0) {
        const ptr0 = passArray8ToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_keypackageinfo_identity(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * End of the key package lifetime, seconds since the Unix epoch.
     * @param {bigint} arg0
     */
    set not_after(arg0) {
        wasm.__wbg_set_keypackageinfo_not_after(this.__wbg_ptr, arg0);
    }
    /**
     * KeyPackageRef (RFC 9420 §5.2): how a Welcome names its recipients.
     * @param {Uint8Array | number[]} arg0
     */
    set reference(arg0) {
        const ptr0 = passArray8ToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_keypackageinfo_reference(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Leaf Ed25519 public key (the device identity key).
     * @param {Uint8Array | number[]} arg0
     */
    set signature_key(arg0) {
        const ptr0 = passArray8ToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_keypackageinfo_signature_key(this.__wbg_ptr, ptr0, len0);
    }
}
if (Symbol.dispose) KeyPackageInfo.prototype[Symbol.dispose] = KeyPackageInfo.prototype.free;
exports.KeyPackageInfo = KeyPackageInfo;

/**
 * DS view of one call (0004 §3.3): OpenMLS `PublicGroup`, the group's public state (tree, context) without any
 * secret. Lets the server check every commit against the real tree before relaying it, and name leaves for Removes.
 */
class PublicCall {
    static __wrap(ptr) {
        const obj = Object.create(PublicCall.prototype);
        obj.__wbg_ptr = ptr;
        PublicCallFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PublicCallFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_publiccall_free(ptr, 0);
    }
    /**
     * A proposal the DS just signed for this epoch: validated against the public state and queued.
     * @param {Uint8Array | number[]} message
     */
    add_proposal(message) {
        const ptr0 = passArray8ToWasm0(message, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.publiccall_add_proposal(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    discard() {
        wasm.publiccall_discard(this.__wbg_ptr);
    }
    /**
     * @returns {bigint}
     */
    epoch() {
        const ret = wasm.publiccall_epoch(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * From the creator's GroupInfo (MLSMessage, with the ratchet_tree extension): verifies tree and signature.
     * @param {Uint8Array | number[]} group_info
     * @returns {PublicCall}
     */
    static from_group_info(group_info) {
        const ptr0 = passArray8ToWasm0(group_info, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.publiccall_from_group_info(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return PublicCall.__wrap(ret[0]);
    }
    /**
     * @returns {Uint8Array}
     */
    group_id() {
        const ret = wasm.publiccall_group_id(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * True when the group's only external sender is this DS key + identity (else its proposals would not apply).
     * @param {Uint8Array | number[]} ds_public_key
     * @param {Uint8Array | number[]} ds_identity
     * @returns {boolean}
     */
    has_external_sender(ds_public_key, ds_identity) {
        let ptr0, len0, ptr1, len1;
        try {
            ptr0 = passArray8ToWasm0(ds_public_key, wasm.__wbindgen_malloc);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passArray8ToWasm0(ds_identity, wasm.__wbindgen_malloc);
            len1 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
            throw e;
        }
        const ret = wasm.publiccall_has_external_sender(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return ret !== 0;
    }
    /**
     * @returns {string}
     */
    members() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.publiccall_members(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Apply the staged commit: the DS ordered it.
     */
    merge() {
        const ret = wasm.publiccall_merge(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * A member's commit for this epoch, from leaf `sender`: verified against the public state (signature, tree,
     * proposals) and held until `merge`/`discard`. It must cover only queued DS proposals (by reference), may not change
     * the committer's identity, and `welcome` must be encrypted to exactly the added key packages (empty when it adds
     * nobody). The confirmation and membership tags are MACs only members can check.
     * @param {Uint8Array | number[]} commit
     * @param {Uint8Array | number[]} welcome
     * @param {number} sender
     * @returns {CommitInfo}
     */
    stage_commit(commit, welcome, sender) {
        const val3 = +sender;
        let ptr0, len0, ptr1, len1;
        try {
            ptr0 = passArray8ToWasm0(commit, wasm.__wbindgen_malloc);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passArray8ToWasm0(welcome, wasm.__wbindgen_malloc);
            len1 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
            throw e;
        }
        const ret = wasm.publiccall_stage_commit(this.__wbg_ptr, ptr0, len0, ptr1, len1, val3);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return CommitInfo.__wrap(ret[0]);
    }
}
if (Symbol.dispose) PublicCall.prototype[Symbol.dispose] = PublicCall.prototype.free;
exports.PublicCall = PublicCall;

/**
 * DS: validates an uploaded key package (exact parse, signatures, ciphersuite 1, lifetime, basic credential).
 * @param {Uint8Array | number[]} bytes
 * @returns {KeyPackageInfo}
 */
function inspect_key_package(bytes) {
    const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.inspect_key_package(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return KeyPackageInfo.__wrap(ret[0]);
}
exports.inspect_key_package = inspect_key_package;

/**
 * DS: KeyPackageRefs a Welcome is encrypted to (32 bytes each, concatenated).
 * @param {Uint8Array | number[]} welcome
 * @returns {Uint8Array}
 */
function welcome_recipients(welcome) {
    const ptr0 = passArray8ToWasm0(welcome, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.welcome_recipients(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}
exports.welcome_recipients = welcome_recipients;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_is_function_741ff2bb612836f5: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_object_8b968c3ab8e96595: function(arg0) {
            const val = arg0;
            const ret = typeof(val) === 'object' && val !== null;
            return ret;
        },
        __wbg___wbindgen_is_string_fc456fee5d3317de: function(arg0) {
            const ret = typeof(arg0) === 'string';
            return ret;
        },
        __wbg___wbindgen_is_undefined_be5b34249ff1fc15: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_throw_4c88d8bf264fd984: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_call_a410eb4b59ed5965: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.call(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_crypto_23f565a907d30078: function(arg0) {
            const ret = arg0.crypto;
            return ret;
        },
        __wbg_getRandomValues_8b6f1f663e6f188d: function() { return handleError(function (arg0, arg1) {
            globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
        }, arguments); },
        __wbg_getRandomValues_d2908e0b99612b91: function() { return handleError(function (arg0, arg1) {
            arg0.getRandomValues(arg1);
        }, arguments); },
        __wbg_length_186163212ffe79c3: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_msCrypto_d5f06fad6bf1409b: function(arg0) {
            const ret = arg0.msCrypto;
            return ret;
        },
        __wbg_new_with_length_01b143a7e5dd5a3e: function(arg0) {
            const ret = new Uint8Array(arg0 >>> 0);
            return ret;
        },
        __wbg_node_86166ff8ce1f2002: function(arg0) {
            const ret = arg0.node;
            return ret;
        },
        __wbg_now_463ac581d2fc7ea3: function() {
            const ret = Date.now();
            return ret;
        },
        __wbg_process_91f425a63f58e399: function(arg0) {
            const ret = arg0.process;
            return ret;
        },
        __wbg_prototypesetcall_13162965d1fe7aa3: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_randomFillSync_34b023059e3363de: function() { return handleError(function (arg0, arg1) {
            arg0.randomFillSync(arg1);
        }, arguments); },
        __wbg_require_9a7d8cc2e1d275c0: function() { return handleError(function () {
            const ret = module.require;
            return ret;
        }, arguments); },
        __wbg_static_accessor_GLOBAL_THIS_003ee833af9699fc: function() {
            const ret = typeof globalThis === 'undefined' ? undefined : globalThis;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_GLOBAL_e4293fb22cbe77da: function() {
            const ret = typeof global === 'undefined' ? undefined : global;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_SELF_53bb20457401453d: function() {
            const ret = typeof self === 'undefined' ? undefined : self;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_WINDOW_b5e0810bfecb7feb: function() {
            const ret = typeof window === 'undefined' ? undefined : window;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_subarray_58f388a9247ac0bb: function(arg0, arg1, arg2) {
            const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
            return ret;
        },
        __wbg_versions_6e128a981b0df859: function(arg0) {
            const ret = arg0.versions;
            return ret;
        },
        __wbindgen_generic_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(U8)) -> NamedExternref("Uint8Array")`.
            const ret = getArrayU8FromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_generic_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            table.set(0, undefined);
            table.set(1024, undefined);
            table.set(1025, null);
            table.set(1026, true);
            table.set(1027, false);
        },
    };
    return {
        __proto__: null,
        "./alga_mls_bg.js": import0,
    };
}

const ClientFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_client_free(ptr, 1));
const CommitFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_commit_free(ptr, 1));
const CommitInfoFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_commitinfo_free(ptr, 1));
const KeyPackageInfoFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_keypackageinfo_free(ptr, 1));
const PublicCallFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_publiccall_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
cachedTextDecoder.decode();
function decodeText(bytes) {
    return cachedTextDecoder.decode(bytes);
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

const wasmPath = `${__dirname}/alga_mls_bg.wasm`;
const wasmBytes = require('fs').readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBytes);
let wasmInstance = new WebAssembly.Instance(wasmModule, __wbg_get_imports());
let wasm = wasmInstance.exports;
wasm.__wbindgen_start();
