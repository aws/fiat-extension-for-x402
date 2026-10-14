// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import type { DPoPNonceStore } from '@aws/fiat-extension-for-x402';

/**
 * Remembers DPoP proof ids so a replayed proof is refused. This one is for a
 * single process; with several instances, use a store they share (for example
 * Redis `SET jti 1 NX EX 71`, done in `has`, which gets no expiry: a proof
 * can be first used 5 seconds before its `iat` and is refused from `expiresAt`,
 * `iat + 66` with the default maximum age of 60 seconds).
 */
export class MemoryNonceStore implements DPoPNonceStore {
  /**
   * Ids are recorded only for payment tokens the facilitator accepted, but a
   * busy seller can still hold many. When this many are held and none has
   * expired, every new proof is refused rather than an id forgotten early.
   */
  static readonly MAX_IDS = 100_000;
  private readonly seen = new Map<string, number>();
  private lastPrune = 0;

  /** True while the time is before the id's `expiresAt`, and when the store is full */
  has(jti: string): boolean {
    const expiresAt = this.seen.get(jti);
    if (expiresAt !== undefined) return Date.now() / 1000 < expiresAt;
    if (this.seen.size >= MemoryNonceStore.MAX_IDS) {
      this.prune(true);
      return this.seen.size >= MemoryNonceStore.MAX_IDS;
    }
    return false;
  }

  add(jti: string, expiresAt: number): void {
    this.seen.set(jti, expiresAt);
    this.prune(false);
  }

  /** Forget expired ids: at most once a minute, or once a second when full */
  private prune(full: boolean): void {
    const now = Date.now() / 1000;
    if (now - this.lastPrune < (full ? 1 : 60)) return;
    this.lastPrune = now;
    for (const [id, until] of this.seen) {
      if (until <= now) this.seen.delete(id);
    }
  }
}
