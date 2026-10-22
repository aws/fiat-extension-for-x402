// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import * as AgenticCommerce from '../../src/index';

describe('Agentic Commerce Package Exports', () => {
  it('should export the exact server scheme and its register helper', () => {
    expect(AgenticCommerce.ExactAgenticCommerceServerScheme).toBeDefined();
    expect(AgenticCommerce.registerExactAgenticCommerceServer).toBeDefined();
  });

  it('should export the exact facilitator scheme and the verifier', () => {
    expect(AgenticCommerce.ExactAgenticCommerceFacilitatorScheme).toBeDefined();
    expect(AgenticCommerce.AgenticCommerceVerifier).toBeDefined();
    expect('AgenticCommerceFacilitatorScheme' in AgenticCommerce).toBe(false);
  });

  it('should export the quote signers and the JWKS helper', () => {
    expect(typeof AgenticCommerce.LocalQuoteSigner.fromPem).toBe('function');
    expect(typeof AgenticCommerce.KmsQuoteSigner).toBe('function');
    expect(typeof AgenticCommerce.jwksDocument).toBe('function');
  });

  it('should export error classes', () => {
    expect(AgenticCommerce.AgenticCommerceError).toBeDefined();
    expect(AgenticCommerce.ValidationError).toBeDefined();
    expect(AgenticCommerce.DPoPError).toBeDefined();
  });

  it('should export constants', () => {
    expect(AgenticCommerce.SCHEME_EXACT).toBe('exact');
    expect(AgenticCommerce.AGENTIC_COMMERCE_CAIP_FAMILY).toBe('aws:*');
    expect(AgenticCommerce.SENTINEL_PAY_TO).toBe('urn:x402:agentic-commerce:see-quote');
  });

  it('should export utility functions', () => {
    expect(AgenticCommerce.decodeQuoteToken).toBeDefined();
    expect(AgenticCommerce.parseMoneyToDecimal).toBeDefined();
  });
});
