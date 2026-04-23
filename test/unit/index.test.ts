import { describe, it, expect } from 'vitest';
import * as FAB from '../../src/index';

describe('FAB Package Exports', () => {
  it('should export FABClientScheme', () => {
    expect(FAB.FABClientScheme).toBeDefined();
  });

  it('should export FABServerScheme', () => {
    expect(FAB.FABServerScheme).toBeDefined();
  });

  it('should export FABFacilitatorScheme', () => {
    expect(FAB.FABFacilitatorScheme).toBeDefined();
  });

  it('should export signer functions', () => {
    expect(FAB.toServiceFABSigner).toBeDefined();
    expect(FAB.toWalletFABSigner).toBeDefined();
  });

  it('should export error classes', () => {
    expect(FAB.FABError).toBeDefined();
    expect(FAB.ValidationError).toBeDefined();
    expect(FAB.SignatureError).toBeDefined();
    expect(FAB.ExpiryError).toBeDefined();
    expect(FAB.MismatchError).toBeDefined();
    expect(FAB.DPoPError).toBeDefined();
  });

  it('should export constants', () => {
    expect(FAB.FAB_SCHEME).toBe('fab');
    expect(FAB.FAB_CAIP_FAMILY).toBe('fab:*');
    expect(FAB.SETTLEMENT_METHODS).toBeDefined();
    expect(FAB.SETTLEMENT_CYCLES).toBeDefined();
  });

  it('should export utility functions', () => {
    expect(FAB.decodeQuoteToken).toBeDefined();
    expect(FAB.verifyQuoteToken).toBeDefined();
    expect(FAB.verifyPaymentToken).toBeDefined();
    expect(FAB.extractQuoteFromPayment).toBeDefined();
    expect(FAB.generateTransactionId).toBeDefined();
    expect(FAB.parseMoneyToDecimal).toBeDefined();
  });
});
