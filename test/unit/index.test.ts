import { describe, it, expect } from 'vitest';
import * as AgenticPay from '../../src/index';

describe('Agentic Pay Package Exports', () => {
  it('should export AgenticPayClientScheme', () => {
    expect(AgenticPay.AgenticPayClientScheme).toBeDefined();
  });

  it('should export AgenticPayServerScheme', () => {
    expect(AgenticPay.AgenticPayServerScheme).toBeDefined();
  });

  it('should export AgenticPayFacilitatorScheme', () => {
    expect(AgenticPay.AgenticPayFacilitatorScheme).toBeDefined();
  });

  it('should export signer functions', () => {
    expect(AgenticPay.toServiceAgenticPaySigner).toBeDefined();
    expect(AgenticPay.toAgenticPaySigner).toBeDefined();
  });

  it('should export error classes', () => {
    expect(AgenticPay.AgenticPayError).toBeDefined();
    expect(AgenticPay.ValidationError).toBeDefined();
    expect(AgenticPay.SignatureError).toBeDefined();
    expect(AgenticPay.ExpiryError).toBeDefined();
    expect(AgenticPay.MismatchError).toBeDefined();
    expect(AgenticPay.DPoPError).toBeDefined();
  });

  it('should export constants', () => {
    expect(AgenticPay.AGENTIC_PAY_SCHEME).toBe('aws:marketplace');
    expect(AgenticPay.AGENTIC_PAY_CAIP_FAMILY).toBe('aws:*');
    expect(AgenticPay.SETTLEMENT_METHODS).toBeDefined();
    expect(AgenticPay.SETTLEMENT_CYCLES).toBeDefined();
  });

  it('should export utility functions', () => {
    expect(AgenticPay.decodeQuoteToken).toBeDefined();
    expect(AgenticPay.verifyQuoteToken).toBeDefined();
    expect(AgenticPay.verifyPaymentToken).toBeDefined();
    expect(AgenticPay.extractQuoteFromPayment).toBeDefined();
    expect(AgenticPay.generateTransactionId).toBeDefined();
    expect(AgenticPay.parseMoneyToDecimal).toBeDefined();
  });
});
