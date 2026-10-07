// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import * as AgentPay from '../../src/index';

describe('Agent Pay Package Exports', () => {
  it('should export AgentPayClientScheme', () => {
    expect(AgentPay.AgentPayClientScheme).toBeDefined();
  });

  it('should export AgentPayServerScheme', () => {
    expect(AgentPay.AgentPayServerScheme).toBeDefined();
  });

  it('should export AgentPayFacilitatorScheme', () => {
    expect(AgentPay.AgentPayFacilitatorScheme).toBeDefined();
  });

  it('should export signer functions', () => {
    expect(AgentPay.toServiceAgentPaySigner).toBeDefined();
    expect(AgentPay.toAgentPaySigner).toBeDefined();
  });

  it('should export error classes', () => {
    expect(AgentPay.AgentPayError).toBeDefined();
    expect(AgentPay.ValidationError).toBeDefined();
    expect(AgentPay.SignatureError).toBeDefined();
    expect(AgentPay.ExpiryError).toBeDefined();
    expect(AgentPay.MismatchError).toBeDefined();
    expect(AgentPay.DPoPError).toBeDefined();
  });

  it('should export constants', () => {
    expect(AgentPay.AGENT_PAY_SCHEME).toBe('agent-pay');
    expect(AgentPay.AGENT_PAY_CAIP_FAMILY).toBe('aws:*');
    expect(AgentPay.SETTLEMENT_METHODS).toBeDefined();
    expect(AgentPay.SETTLEMENT_CYCLES).toBeDefined();
  });

  it('should export utility functions', () => {
    expect(AgentPay.decodeQuoteToken).toBeDefined();
    expect(AgentPay.verifyQuoteToken).toBeDefined();
    expect(AgentPay.verifyPaymentToken).toBeDefined();
    expect(AgentPay.extractQuoteFromPayment).toBeDefined();
    expect(AgentPay.generateTransactionId).toBeDefined();
    expect(AgentPay.parseMoneyToDecimal).toBeDefined();
  });
});
