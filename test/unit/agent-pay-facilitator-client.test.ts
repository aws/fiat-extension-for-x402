// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { AgentPayFacilitatorClient } from '../../src/agent-pay-facilitator-client';
import { ValidationError } from '../../src/types';

describe('AgentPayFacilitatorClient constructor', () => {
  it('should require agentPayBaseUrl', () => {
    const construct = () => new AgentPayFacilitatorClient(undefined as unknown as string);
    expect(construct).toThrow(ValidationError);
    expect(construct).toThrow('agentPayBaseUrl is required');
  });

  it('should reject an empty agentPayBaseUrl', () => {
    expect(() => new AgentPayFacilitatorClient('')).toThrow('agentPayBaseUrl is required');
  });
});
