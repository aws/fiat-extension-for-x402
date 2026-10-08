// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, it, expect, vi } from 'vitest';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { AgenticCommerceFacilitatorClient } from '../../../src/agentic-commerce/facilitator-client';
import { DEFAULT_PAYMENT_TOKEN_JWKS_BASE_URL, WELL_KNOWN_JWKS_PATH } from '../../../src/constants';
import { ValidationError } from '../../../src/types';

describe('AgenticCommerceFacilitatorClient constructor', () => {
  it('should require agenticCommerceBaseUrl', () => {
    const construct = () => new AgenticCommerceFacilitatorClient(undefined as unknown as string);
    expect(construct).toThrow(ValidationError);
    expect(construct).toThrow('agenticCommerceBaseUrl is required');
  });

  it('should reject an empty agenticCommerceBaseUrl', () => {
    expect(() => new AgenticCommerceFacilitatorClient('')).toThrow(
      'agenticCommerceBaseUrl is required'
    );
  });
});

describe('AgenticCommerceFacilitatorClient payment-token JWKS fetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should fetch the default JWKS host with no access header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new AgenticCommerceFacilitatorClient('https://facilitator.example.com');
    const result = await client.verify(
      { payload: { paymentToken: 'x' } } as unknown as PaymentPayload,
      { extra: { quoteToken: 'y' } } as unknown as PaymentRequirements
    );

    expect(result.isValid).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${DEFAULT_PAYMENT_TOKEN_JWKS_BASE_URL}${WELL_KNOWN_JWKS_PATH}`);
    expect(init.headers).toEqual({});
  });
});
