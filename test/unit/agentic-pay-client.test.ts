/**
 * DefaultAgenticPayClient Tests
 * 
 * Verifies the HTTP client calls the correct Agent Pay API endpoints
 * with the correct request shape and handles responses properly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as jose from 'jose';
import { DefaultAgenticPayClient } from '../../src/agentic-pay-client';
import { ValidationError, IdempotencyConflictError } from '../../src/types';

describe('DefaultAgenticPayClient', () => {
  const mockFetch = vi.fn();
  const baseUrl = 'https://pay.aws.amazon.com';
  let client: DefaultAgenticPayClient;

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    client = new DefaultAgenticPayClient({ baseUrl });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createPayment', () => {
    it('should POST to /CreateAgentPayment', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          paymentId: 'awsmp-00000000-0000-0000-0000-000000000001',
          paymentToken: 'eyJ...',
          createdAt: '2026-05-12T00:00:00Z',
        }),
      });

      await client.createPayment({ quoteToken: 'qt-123' });

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://pay.aws.amazon.com/CreateAgentPayment');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
    });

    it('should send quoteToken in request body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          paymentId: 'awsmp-test',
          paymentToken: 'tok',
          createdAt: '2026-01-01T00:00:00Z',
        }),
      });

      await client.createPayment({ quoteToken: 'my-quote-token' });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.quoteToken).toBe('my-quote-token');
    });

    it('should include clientToken when provided', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          paymentId: 'awsmp-test',
          paymentToken: 'tok',
          createdAt: '2026-01-01T00:00:00Z',
        }),
      });

      await client.createPayment({ quoteToken: 'qt', clientToken: 'idem-key' });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.clientToken).toBe('idem-key');
    });

    it('should NOT include clientToken when not provided', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          paymentId: 'awsmp-test',
          paymentToken: 'tok',
          createdAt: '2026-01-01T00:00:00Z',
        }),
      });

      await client.createPayment({ quoteToken: 'qt' });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.clientToken).toBeUndefined();
    });

    it('should include dpopJwk when provided', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          paymentId: 'awsmp-test',
          paymentToken: 'tok',
          createdAt: '2026-01-01T00:00:00Z',
        }),
      });

      const dpopJwk = { kty: 'EC' as const, crv: 'P-256' as const, x: 'abc', y: 'def' };
      await client.createPayment({ quoteToken: 'qt', dpopJwk });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.dpopJwk).toEqual(dpopJwk);
    });

    it('should return paymentId, paymentToken, createdAt', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          paymentId: 'awsmp-abc-123',
          paymentToken: 'signed-jwt',
          createdAt: '2026-05-12T10:00:00Z',
        }),
      });

      const result = await client.createPayment({ quoteToken: 'qt' });

      expect(result.paymentId).toBe('awsmp-abc-123');
      expect(result.paymentToken).toBe('signed-jwt');
      expect(result.createdAt).toBe('2026-05-12T10:00:00Z');
    });

    it('should throw ValidationError on non-OK response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ message: 'Invalid quote token' }),
      });

      await expect(client.createPayment({ quoteToken: 'bad' }))
        .rejects.toThrow(ValidationError);
    });

    it('should throw IdempotencyConflictError on 409', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        json: async () => ({ message: 'Conflict' }),
      });

      await expect(client.createPayment({ quoteToken: 'qt', clientToken: 'dup' }))
        .rejects.toThrow(IdempotencyConflictError);
    });

    it('should throw ValidationError when response missing paymentId', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ paymentToken: 'tok', createdAt: '2026-01-01' }),
      });

      await expect(client.createPayment({ quoteToken: 'qt' }))
        .rejects.toThrow('missing paymentId or paymentToken');
    });

    it('should strip trailing slash from baseUrl', async () => {
      const clientWithSlash = new DefaultAgenticPayClient({ baseUrl: 'https://pay.aws.amazon.com/' });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ paymentId: 'x', paymentToken: 'y', createdAt: 'z' }),
      });

      await clientWithSlash.createPayment({ quoteToken: 'qt' });

      expect(mockFetch.mock.calls[0][0]).toBe('https://pay.aws.amazon.com/CreateAgentPayment');
    });
  });

  describe('getPayment', () => {
    it('should GET /GetAgentPayment/{paymentId}', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ payment: { paymentId: 'awsmp-123' } }),
      });

      await client.getPayment('awsmp-123');

      expect(mockFetch.mock.calls[0][0]).toBe('https://pay.aws.amazon.com/GetAgentPayment/awsmp-123');
      expect(mockFetch.mock.calls[0][1].method).toBe('GET');
    });

    it('should throw ValidationError on non-OK response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Not found' }),
      });

      await expect(client.getPayment('awsmp-missing'))
        .rejects.toThrow(ValidationError);
    });
  });

  describe('listPayments', () => {
    it('should POST to /ListAgentPayments', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ payments: [] }),
      });

      await client.listPayments({ maxResults: 10 });

      expect(mockFetch.mock.calls[0][0]).toBe('https://pay.aws.amazon.com/ListAgentPayments');
      expect(mockFetch.mock.calls[0][1].method).toBe('POST');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.maxResults).toBe(10);
    });
  });

  describe('verifyPaymentToken', () => {
    it('should throw ValidationError for invalid token', async () => {
      await expect(client.verifyPaymentToken('not-a-jwt'))
        .rejects.toThrow(ValidationError);
    });

    // Note: Full verifyPaymentToken testing with real JWKS fetch is covered
    // in integration tests (agentic-pay-test.test.ts) where the mock server serves JWKS.
    // Unit testing createRemoteJWKSet requires a real HTTP server because jose
    // uses its own internal fetch that doesn't respect vi.stubGlobal.
  });

  describe('authentication', () => {
    it('should apply authenticator to createPayment requests', async () => {
      const clientWithAuth = new DefaultAgenticPayClient({
        baseUrl,
        auth: {
          type: 'awsSigV4',
          region: 'us-east-1',
          credentials: { accessKeyId: 'AKIA-TEST', secretAccessKey: 'secret' },
        },
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ paymentId: 'x', paymentToken: 'y', createdAt: 'z' }),
      });

      await clientWithAuth.createPayment({ quoteToken: 'qt' });

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['Authorization']).toContain('AWS4-HMAC-SHA256');
      expect(headers['x-amz-date']).toBeDefined();
    });
  });
});
