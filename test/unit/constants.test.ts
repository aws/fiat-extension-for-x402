// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import {
  SCHEME_EXACT,
  DEFAULT_QUOTE_VALIDITY_SECONDS,
  AGENTIC_COMMERCE_CAIP_FAMILY,
} from '../../src/constants';

describe('Constants', () => {
  describe('SCHEME_EXACT', () => {
    it('should be "exact"', () => {
      expect(SCHEME_EXACT).toBe('exact');
    });
  });

  describe('AGENTIC_COMMERCE_CAIP_FAMILY', () => {
    it('should be "fab:*"', () => {
      expect(AGENTIC_COMMERCE_CAIP_FAMILY).toBe('aws:*');
    });
  });

  describe('DEFAULT_QUOTE_VALIDITY_SECONDS', () => {
    it('should be 300 seconds (5 minutes)', () => {
      expect(DEFAULT_QUOTE_VALIDITY_SECONDS).toBe(300);
    });
  });
});
