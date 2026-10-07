// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import {
  AGENT_PAY_SCHEME,
  SETTLEMENT_METHODS,
  SETTLEMENT_CYCLES,
  DEFAULT_QUOTE_VALIDITY_SECONDS,
  DEFAULT_PAYMENT_VALIDITY_SECONDS,
  AGENT_PAY_CAIP_FAMILY,
} from '../../src/constants';

describe('Constants', () => {
  describe('AGENT_PAY_SCHEME', () => {
    it('should be "aws:base"', () => {
      expect(AGENT_PAY_SCHEME).toBe('agent-pay');
    });
  });

  describe('AGENT_PAY_CAIP_FAMILY', () => {
    it('should be "fab:*"', () => {
      expect(AGENT_PAY_CAIP_FAMILY).toBe('aws:*');
    });
  });

  describe('SETTLEMENT_METHODS', () => {
    it('should contain all valid settlement methods', () => {
      expect(SETTLEMENT_METHODS).toEqual({
        INST: 'INST',
        CLRG: 'CLRG',
        CRDT: 'CRDT',
      });
    });

    it('should be an object', () => {
      expect(typeof SETTLEMENT_METHODS).toBe('object');
      expect(SETTLEMENT_METHODS.INST).toBe('INST');
    });
  });

  describe('SETTLEMENT_CYCLES', () => {
    it('should contain all valid settlement cycles', () => {
      expect(SETTLEMENT_CYCLES).toEqual({
        MNTH: 'MNTH',
        WEEK: 'WEEK',
        QRTR: 'QRTR',
      });
    });

    it('should be an object', () => {
      expect(typeof SETTLEMENT_CYCLES).toBe('object');
      expect(SETTLEMENT_CYCLES.MNTH).toBe('MNTH');
    });
  });

  describe('DEFAULT_QUOTE_VALIDITY_SECONDS', () => {
    it('should be 300 seconds (5 minutes)', () => {
      expect(DEFAULT_QUOTE_VALIDITY_SECONDS).toBe(300);
    });
  });

  describe('DEFAULT_PAYMENT_VALIDITY_SECONDS', () => {
    it('should be 3600 seconds (1 hour)', () => {
      expect(DEFAULT_PAYMENT_VALIDITY_SECONDS).toBe(3600);
    });
  });
});
