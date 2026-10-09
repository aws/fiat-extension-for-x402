// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import * as AgenticCommerce from '../../src/index';

describe('Agentic Commerce Package Exports', () => {
  it('should export the exact server scheme and its register helper', () => {
    expect(AgenticCommerce.ExactAgenticCommerceServerScheme).toBeDefined();
    expect(AgenticCommerce.registerExactAgenticCommerceServer).toBeDefined();
  });

  it('should export AgenticCommerceFacilitatorScheme', () => {
    expect(AgenticCommerce.AgenticCommerceFacilitatorScheme).toBeDefined();
  });

  it('should export signer functions', () => {
    expect(AgenticCommerce.toQuoteSigner).toBeDefined();
    expect(AgenticCommerce.toPaymentTokenSigner).toBeDefined();
  });

  it('should export error classes', () => {
    expect(AgenticCommerce.AgenticCommerceError).toBeDefined();
    expect(AgenticCommerce.ValidationError).toBeDefined();
    expect(AgenticCommerce.SignatureError).toBeDefined();
    expect(AgenticCommerce.ExpiryError).toBeDefined();
    expect(AgenticCommerce.MismatchError).toBeDefined();
    expect(AgenticCommerce.DPoPError).toBeDefined();
  });

  it('should export constants', () => {
    expect(AgenticCommerce.SCHEME_EXACT).toBe('exact');
    expect(AgenticCommerce.AGENTIC_COMMERCE_CAIP_FAMILY).toBe('aws:*');
    expect(AgenticCommerce.SETTLEMENT_METHODS).toBeDefined();
    expect(AgenticCommerce.SETTLEMENT_CYCLES).toBeDefined();
  });

  it('should export utility functions', () => {
    expect(AgenticCommerce.decodeQuoteToken).toBeDefined();
    expect(AgenticCommerce.verifyQuoteToken).toBeDefined();
    expect(AgenticCommerce.verifyPaymentToken).toBeDefined();
    expect(AgenticCommerce.extractQuoteFromPayment).toBeDefined();
    expect(AgenticCommerce.generateTransactionId).toBeDefined();
    expect(AgenticCommerce.parseMoneyToDecimal).toBeDefined();
  });
});
