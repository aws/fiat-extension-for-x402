// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import {
  AgentPayAWSClientScheme,
  AgentPayAWSServerScheme,
  AgentPayAWSFacilitatorScheme,
} from '../../../src/networks/aws';
import * as jose from 'jose';

describe('AWS Network Schemes', () => {
  describe('AgentPayAWSClientScheme', () => {
    it('should create client scheme with AWS Agent Pay configuration', () => {
      const scheme = new AgentPayAWSClientScheme({ agentPayId: 'test-agent-pay-123' });

      expect(scheme).toBeDefined();
      expect(scheme.scheme).toBe('agent-pay');
      // Network is set during initialization, not exposed as property
    });

    it('should accept different Agent Pay IDs', () => {
      const scheme1 = new AgentPayAWSClientScheme({ agentPayId: 'agent-pay-1' });
      const scheme2 = new AgentPayAWSClientScheme({ agentPayId: 'agent-pay-2' });

      expect(scheme1).toBeDefined();
      expect(scheme2).toBeDefined();
      expect(scheme1.scheme).toBe('agent-pay');
      expect(scheme2.scheme).toBe('agent-pay');
    });

    it('should be instance of base client scheme', () => {
      const scheme = new AgentPayAWSClientScheme({ agentPayId: 'test' });
      expect(scheme.scheme).toBe('agent-pay');
    });
  });

  describe('AgentPayAWSServerScheme', () => {
    it('should create server scheme with AWS Agent Pay configuration', async () => {
      const { privateKey, publicKey } = await jose.generateKeyPair('RS256');
      const publicJWK = await jose.exportJWK(publicKey);

      const scheme = new AgentPayAWSServerScheme({
        signingKeys: {
          privateKey,
          publicKey: publicJWK,
          alg: 'RS256',
        },
        serviceUrl: 'https://api.example.com',
      });

      expect(scheme).toBeDefined();
      expect(scheme.scheme).toBe('agent-pay');
    });

    it('should work with ES256 keys', async () => {
      const { privateKey, publicKey } = await jose.generateKeyPair('ES256');
      const publicJWK = await jose.exportJWK(publicKey);

      const scheme = new AgentPayAWSServerScheme({
        signingKeys: {
          privateKey,
          publicKey: publicJWK,
          alg: 'ES256',
        },
        serviceUrl: 'https://api.example.com',
      });

      expect(scheme).toBeDefined();
      expect(scheme.scheme).toBe('agent-pay');
    });

    it('should accept different service URLs', async () => {
      const { privateKey, publicKey } = await jose.generateKeyPair('RS256');
      const publicJWK = await jose.exportJWK(publicKey);

      const scheme1 = new AgentPayAWSServerScheme({
        signingKeys: { privateKey, publicKey: publicJWK, alg: 'RS256' },
        serviceUrl: 'https://api1.example.com',
      });

      const scheme2 = new AgentPayAWSServerScheme({
        signingKeys: { privateKey, publicKey: publicJWK, alg: 'RS256' },
        serviceUrl: 'https://api2.example.com',
      });

      expect(scheme1).toBeDefined();
      expect(scheme2).toBeDefined();
    });
  });

  describe('AgentPayAWSFacilitatorScheme', () => {
    it('should create facilitator scheme with default Agent Pay ID', () => {
      const scheme = new AgentPayAWSFacilitatorScheme();

      expect(scheme).toBeDefined();
      expect(scheme.scheme).toBe('agent-pay');
    });

    it('should create facilitator scheme with custom Agent Pay ID', () => {
      const scheme = new AgentPayAWSFacilitatorScheme('custom-agent-pay-id');

      expect(scheme).toBeDefined();
      expect(scheme.scheme).toBe('agent-pay');
    });

    it('should accept different Agent Pay IDs', () => {
      const scheme1 = new AgentPayAWSFacilitatorScheme('agent-pay-1');
      const scheme2 = new AgentPayAWSFacilitatorScheme('agent-pay-2');

      expect(scheme1).toBeDefined();
      expect(scheme2).toBeDefined();
      expect(scheme1.scheme).toBe('agent-pay');
      expect(scheme2.scheme).toBe('agent-pay');
    });
  });
});
