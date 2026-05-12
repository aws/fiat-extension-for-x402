/**
 * Tests for Agent Pay Express Middleware
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { agentPayMiddleware, type AgentPayMiddlewareConfig } from '../../../src/middleware/express';

// ── Mocks ──────────────────────────────────────────────────────────

// Mock the resource server builder
const mockBuildPaymentRequirements = vi.fn();
const mockCreatePaymentRequiredResponse = vi.fn();
const mockVerifyPayment = vi.fn();
const mockSettlePayment = vi.fn();

const mockServer = {
  buildPaymentRequirements: mockBuildPaymentRequirements,
  createPaymentRequiredResponse: mockCreatePaymentRequiredResponse,
  verifyPayment: mockVerifyPayment,
  settlePayment: mockSettlePayment,
};

const mockRegisterNetwork = vi.fn().mockReturnThis();
const mockInitialize = vi.fn().mockResolvedValue(mockServer);

vi.mock('../../../src/builders/resource-server-builder', () => ({
  createAgentPayResourceServer: vi.fn(() => ({
    registerNetwork: mockRegisterNetwork,
    initialize: mockInitialize,
  })),
}));

// ── Helpers ────────────────────────────────────────────────────────

function createMockReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    path: '/api/premium',
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function createMockRes(): Response & { _status: number; _json: any; _headers: Record<string, string> } {
  const res: any = {
    _status: 200,
    _json: null,
    _headers: {},
    status(code: number) {
      res._status = code;
      return res;
    },
    json(body: any) {
      res._json = body;
      return res;
    },
    set(key: string, value: string) {
      res._headers[key] = value;
      return res;
    },
    setHeader(key: string, value: string) {
      res._headers[key] = value;
      return res;
    },
  };
  return res;
}

const baseConfig: AgentPayMiddlewareConfig = {
  agentPayBaseUrl: 'https://pay.example.com',
  agentPayId: 'test-agent-pay',
  signingKeys: {
    privateKey: {} as any,
    publicKey: { kty: 'RSA' } as any,
    alg: 'RS256',
  },
  serviceUrl: 'https://api.example.com',
  networks: ['aws:base' as any],
  routes: {
    'GET /api/premium': {
      price: 0.15,
      network: 'aws:base' as any,
      payTo: 'seller-pay',
      asset: 'iso4217:USD',
    },
  },
};

// ── Tests ──────────────────────────────────────────────────────────

describe('agentPayMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitialize.mockResolvedValue(mockServer);
  });

  describe('configuration validation', () => {
    it('throws if networks is empty', () => {
      expect(() =>
        agentPayMiddleware({ ...baseConfig, networks: [] })
      ).toThrow('networks must be a non-empty array');
    });

    it('throws if routes is empty', () => {
      expect(() =>
        agentPayMiddleware({ ...baseConfig, routes: {} })
      ).toThrow('routes must be a non-empty object');
    });

    it('throws on invalid route pattern', () => {
      expect(() =>
        agentPayMiddleware({
          ...baseConfig,
          routes: { 'GET /api premium extra': { price: 1, network: 'aws:base' as any, payTo: 'x' } },
        })
      ).toThrow('Invalid route pattern');
    });
  });

  describe('route matching', () => {
    it('passes through requests to non-protected routes', () => {
      const middleware = agentPayMiddleware(baseConfig);
      const req = createMockReq({ path: '/api/public', method: 'GET' });
      const res = createMockRes();
      const next = vi.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalledOnce();
    });

    it('does not pass through for wrong HTTP method', () => {
      const middleware = agentPayMiddleware(baseConfig);
      const req = createMockReq({ path: '/api/premium', method: 'POST' });
      const res = createMockRes();
      const next = vi.fn();

      middleware(req, res, next);

      // POST /api/premium doesn't match "GET /api/premium", so next() is called (pass-through)
      expect(next).toHaveBeenCalledOnce();
    });

    it('matches wildcard routes', () => {
      const config: AgentPayMiddlewareConfig = {
        ...baseConfig,
        routes: {
          'GET /api/*': {
            price: 0.15,
            network: 'aws:base' as any,
            payTo: 'seller-pay',
          },
        },
      };

      const middleware = agentPayMiddleware(config);
      const req = createMockReq({ path: '/api/anything/here', method: 'GET' });
      const res = createMockRes();
      const next = vi.fn();

      // This will match and try to process payment (async), so next won't be called synchronously
      middleware(req, res, next);

      // next() should NOT be called synchronously (it's a protected route)
      expect(next).not.toHaveBeenCalled();
    });

    it('matches routes without method prefix (any method)', () => {
      const config: AgentPayMiddlewareConfig = {
        ...baseConfig,
        routes: {
          '/api/premium': {
            price: 0.15,
            network: 'aws:base' as any,
            payTo: 'seller-pay',
          },
        },
      };

      const middleware = agentPayMiddleware(config);
      const req = createMockReq({ path: '/api/premium', method: 'POST' });
      const res = createMockRes();
      const next = vi.fn();

      middleware(req, res, next);

      // Should match (any method), so next() is NOT called synchronously
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('402 response generation', () => {
    it('returns 402 when no payment header is present', async () => {
      const mockPaymentRequired = {
        x402Version: 2,
        accepts: [{ scheme: 'agent-pay', network: 'aws:base' }],
      };
      mockBuildPaymentRequirements.mockResolvedValue([{ scheme: 'agent-pay' }]);
      mockCreatePaymentRequiredResponse.mockResolvedValue(mockPaymentRequired);

      const middleware = agentPayMiddleware(baseConfig);
      const req = createMockReq({ path: '/api/premium', method: 'GET' });
      const res = createMockRes();
      const next = vi.fn();

      middleware(req, res, next);

      // Wait for async processing
      await vi.waitFor(() => {
        expect(res._status).toBe(402);
      });

      expect(res._json).toEqual(mockPaymentRequired);
      expect(res._headers['WWW-Authenticate']).toContain('x402');
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('payment verification', () => {
    it('verifies payment and calls next() on success', async () => {
      mockVerifyPayment.mockResolvedValue({ isValid: true, payer: 'buyer-123' });

      const paymentPayload = {
        x402Version: 2,
        payload: { paymentToken: 'tok', transactionId: 'awsmp-tx123' },
        accepted: { scheme: 'agent-pay', network: 'aws:base', amount: '0.15', asset: 'iso4217:USD', extra: {} },
      };
      const encoded = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');

      const middleware = agentPayMiddleware(baseConfig);
      const req = createMockReq({
        path: '/api/premium',
        method: 'GET',
        headers: { authorization: `x402 ${encoded}` },
      });
      const res = createMockRes();
      const next = vi.fn();

      middleware(req, res, next);

      await vi.waitFor(() => {
        expect(next).toHaveBeenCalledOnce();
      });

      expect((req as any).agentPayPayment).toEqual({
        payer: 'buyer-123',
        transactionId: 'awsmp-tx123',
        network: 'aws:base',
        amount: '0.15',
        asset: 'iso4217:USD',
      });
    });

    it('returns 402 when verification fails', async () => {
      mockVerifyPayment.mockResolvedValue({
        isValid: false,
        invalidReason: 'expired',
        invalidMessage: 'Payment token expired',
      });

      const paymentPayload = {
        x402Version: 2,
        payload: { paymentToken: 'tok', transactionId: 'awsmp-tx123' },
        accepted: { scheme: 'agent-pay', network: 'aws:base', amount: '0.15', asset: 'iso4217:USD' },
      };
      const encoded = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');

      const middleware = agentPayMiddleware(baseConfig);
      const req = createMockReq({
        path: '/api/premium',
        method: 'GET',
        headers: { authorization: `x402 ${encoded}` },
      });
      const res = createMockRes();
      const next = vi.fn();

      middleware(req, res, next);

      await vi.waitFor(() => {
        expect(res._status).toBe(402);
      });

      expect(res._json.error).toBe('Payment verification failed');
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 400 when payment payload has no accepted field', async () => {
      const paymentPayload = {
        x402Version: 2,
        payload: { paymentToken: 'tok', transactionId: 'awsmp-tx123' },
        // no accepted field
      };
      const encoded = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');

      const middleware = agentPayMiddleware(baseConfig);
      const req = createMockReq({
        path: '/api/premium',
        method: 'GET',
        headers: { authorization: `x402 ${encoded}` },
      });
      const res = createMockRes();
      const next = vi.fn();

      middleware(req, res, next);

      await vi.waitFor(() => {
        expect(res._status).toBe(400);
      });

      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('auto-capture settlement', () => {
    it('does NOT call settlePayment when capture is auto (Agent Pay auto-captures)', async () => {
      mockVerifyPayment.mockResolvedValue({ isValid: true, payer: 'buyer-123' });

      const paymentPayload = {
        x402Version: 2,
        payload: { paymentToken: 'tok', paymentId: 'awsmp-123', transactionId: 'awsmp-123' },
        accepted: {
          scheme: 'agent-pay',
          network: 'aws:base',
          amount: '0.15',
          asset: 'iso4217:USD',
          extra: { capture: 'auto' },
        },
      };
      const encoded = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');

      const middleware = agentPayMiddleware(baseConfig);
      const req = createMockReq({
        path: '/api/premium',
        method: 'GET',
        headers: { authorization: `x402 ${encoded}` },
      });
      const res = createMockRes();
      const next = vi.fn();

      middleware(req, res, next);

      await vi.waitFor(() => {
        expect(next).toHaveBeenCalledOnce();
      });

      // Agent Pay auto-captures — no settle call should be made
      expect(mockSettlePayment).not.toHaveBeenCalled();
    });

    it('calls onPaymentSettled hook for auto-capture without HTTP settle call', async () => {
      mockVerifyPayment.mockResolvedValue({ isValid: true, payer: 'buyer-123' });
      const onPaymentSettled = vi.fn();

      const paymentPayload = {
        x402Version: 2,
        payload: { paymentToken: 'tok', paymentId: 'awsmp-123', transactionId: 'awsmp-123' },
        accepted: {
          scheme: 'agent-pay',
          network: 'aws:base',
          amount: '0.15',
          asset: 'iso4217:USD',
          extra: { capture: 'auto' },
        },
      };
      const encoded = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');

      const middleware = agentPayMiddleware({ ...baseConfig, onPaymentSettled });
      const req = createMockReq({
        path: '/api/premium',
        method: 'GET',
        headers: { authorization: `x402 ${encoded}` },
      });
      const res = createMockRes();
      const next = vi.fn();

      middleware(req, res, next);

      await vi.waitFor(() => {
        expect(next).toHaveBeenCalledOnce();
      });

      // Hook is called even though no HTTP settle was made
      expect(onPaymentSettled).toHaveBeenCalledOnce();
      expect(mockSettlePayment).not.toHaveBeenCalled();
    });
  });

  describe('hooks', () => {
    it('calls onPaymentVerified hook after verification', async () => {
      mockVerifyPayment.mockResolvedValue({ isValid: true, payer: 'buyer-123' });
      const onPaymentVerified = vi.fn();

      const paymentPayload = {
        x402Version: 2,
        payload: { paymentToken: 'tok', transactionId: 'awsmp-tx123' },
        accepted: { scheme: 'agent-pay', network: 'aws:base', amount: '0.15', asset: 'iso4217:USD', extra: {} },
      };
      const encoded = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');

      const middleware = agentPayMiddleware({ ...baseConfig, onPaymentVerified });
      const req = createMockReq({
        path: '/api/premium',
        method: 'GET',
        headers: { authorization: `x402 ${encoded}` },
      });
      const res = createMockRes();
      const next = vi.fn();

      middleware(req, res, next);

      await vi.waitFor(() => {
        expect(onPaymentVerified).toHaveBeenCalledOnce();
      });

      expect(onPaymentVerified.mock.calls[0][1].payer).toBe('buyer-123');
    });

    it('calls onError hook on exceptions', async () => {
      mockVerifyPayment.mockRejectedValue(new Error('boom'));
      const onError = vi.fn();

      const paymentPayload = {
        x402Version: 2,
        payload: { paymentToken: 'tok', transactionId: 'awsmp-tx123' },
        accepted: { scheme: 'agent-pay', network: 'aws:base', amount: '0.15', asset: 'iso4217:USD' },
      };
      const encoded = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');

      const middleware = agentPayMiddleware({ ...baseConfig, onError });
      const req = createMockReq({
        path: '/api/premium',
        method: 'GET',
        headers: { authorization: `x402 ${encoded}` },
      });
      const res = createMockRes();
      const next = vi.fn();

      middleware(req, res, next);

      await vi.waitFor(() => {
        expect(onError).toHaveBeenCalledOnce();
      });

      expect(onError.mock.calls[0][0].message).toBe('boom');
    });
  });
});
