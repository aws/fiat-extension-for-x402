/**
 * Express Middleware for Agent Pay x402 Payment Protection
 *
 * Provides plug-and-play Express middleware that protects routes with Agent Pay payments.
 * Handles the full lifecycle: 402 generation, payment verification, and settlement.
 *
 * This middleware works directly with @x402/core and the Agent Pay builders — it does NOT
 * depend on x402-express. If you already use x402-express's paymentMiddleware,
 * you can use createAgentPayResourceServer directly instead of this middleware.
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { agentPayMiddleware } from 'aws-agent-pay-x402/middleware/express';
 *
 * const app = express();
 * app.use(express.json());
 *
 * app.use(agentPayMiddleware({
 *   agentPayBaseUrl: 'https://pay.aws.amazon.com',
 *   agentPayId: 'my-agent-pay',
 *   signingKeys: { privateKey, publicKey: publicJWK, alg: 'RS256' },
 *   serviceUrl: 'https://api.example.com',
 *   networks: ['aws:base'],
 *   routes: {
 *     'GET /api/premium': {
 *       price: 0.15,
 *       network: 'aws:base',
 *       payTo: 'seller-agent-pay-id',
 *       asset: 'iso4217:USD',
 *     },
 *   },
 * }));
 *
 * app.get('/api/premium', (req, res) => {
 *   res.json({ data: 'premium content' });
 * });
 * ```
 */

import type { Request, Response, NextFunction } from 'express';
import type { Network } from '@x402/core/types';
import type { x402ResourceServer } from '@x402/core/server';
import type { SigningKeysConfig } from '../config';
import type { AgentPayFacilitatorAuthConfig } from '../agent-pay-facilitator-client';
import { createAgentPayResourceServer } from '../builders/resource-server-builder';
import { ValidationError } from '../types';

// ── Types ──────────────────────────────────────────────────────────

/**
 * Per-route payment configuration.
 */
export interface AgentPayRouteConfig {
  /** Price for this route (e.g., 0.15) */
  price: number | string;
  /** Network to use (e.g., 'aws:base') */
  network: Network;
  /** Recipient Agent Pay ID */
  payTo: string;
  /** Asset identifier (e.g., 'iso4217:USD'). Used in PaymentInfo only; the scheme derives the asset from the price. */
  asset?: string;
  /** Human-readable description of what is being charged for (included in quote token) */
  description?: string;
  /** Key-value dimensions describing units consumed (included in quote token) */
  dimensions?: Record<string, string | number>;
  /** MIME type of the protected resource */
  mimeType?: string;
  /** Extra fields to include in the quote token */
  extra?: Record<string, unknown>;
}

/**
 * Routes map: "METHOD /path" → route config.
 *
 * Path matching supports:
 * - Exact: "GET /api/premium"
 * - Wildcard: "GET /api/*"
 * - All methods: "/api/premium" (matches any HTTP method)
 */
export type AgentPayRoutesConfig = Record<string, AgentPayRouteConfig>;

/**
 * Middleware configuration.
 */
export interface AgentPayMiddlewareConfig {
  /** Agent Pay provider base URL */
  agentPayBaseUrl: string;
  /** Agent Pay ID for the Agent Pay facilitator */
  agentPayId: string;
  /** Service signing keys for quote tokens */
  signingKeys: SigningKeysConfig;
  /** Service URL (used as issuer in quote tokens) */
  serviceUrl: string;
  /** Networks to register for Agent Pay (e.g., ['aws:base']) */
  networks: Network[];
  /** Route payment configurations */
  routes: AgentPayRoutesConfig;
  /** Optional Agent Pay auth for facilitator API calls */
  agentPayAuth?: AgentPayFacilitatorAuthConfig;
  /** Disable default x402 facilitator fallback. Defaults to false. */
  disableDefaultFallback?: boolean;

  /**
   * Hook called after successful payment verification, before the route handler.
   * Throw to reject the request even after valid payment.
   */
  onPaymentVerified?: (req: Request, payment: PaymentInfo) => void | Promise<void>;

  /**
   * Hook called after successful settlement.
   */
  onPaymentSettled?: (req: Request, payment: PaymentInfo, transaction: string) => void | Promise<void>;

  /**
   * Custom error handler. If not provided, errors are returned as JSON.
   */
  onError?: (err: Error, req: Request, res: Response) => void;
}

/**
 * Payment information attached to the request after verification.
 */
export interface PaymentInfo {
  /** Payer identity (from payment token) */
  payer: string;
  /** Transaction ID */
  transactionId: string;
  /** Network used */
  network: string;
  /** Amount paid */
  amount: string;
  /** Asset (e.g., 'iso4217:USD') */
  asset: string;
}

// Extend Express Request to carry payment info
declare global {
  namespace Express {
    interface Request {
      /** Agent Pay payment info, set by agentPayMiddleware after successful verification */
      agentPayPayment?: PaymentInfo;
    }
  }
}

// ── Route matching ─────────────────────────────────────────────────

interface CompiledRoute {
  method: string; // uppercase, or '*' for any
  regex: RegExp;
  config: AgentPayRouteConfig;
}

function compileRoutes(routes: AgentPayRoutesConfig): CompiledRoute[] {
  return Object.entries(routes).map(([pattern, config]) => {
    // Parse "METHOD /path" or just "/path"
    const parts = pattern.trim().split(/\s+/);
    let method: string;
    let path: string;

    if (parts.length === 2) {
      method = parts[0].toUpperCase();
      path = parts[1];
    } else if (parts.length === 1) {
      method = '*';
      path = parts[0];
    } else {
      throw new ValidationError(`Invalid route pattern: "${pattern}". Expected "METHOD /path" or "/path".`);
    }

    // Convert path to regex: /api/* → /api/.*, /api/:id → /api/[^/]+
    const regexStr = path
      .replace(/\*/g, '.*')
      .replace(/:([^/]+)/g, '([^/]+)');
    const regex = new RegExp(`^${regexStr}$`);

    return { method, regex, config };
  });
}

function matchRoute(compiledRoutes: CompiledRoute[], method: string, path: string): AgentPayRouteConfig | undefined {
  for (const route of compiledRoutes) {
    if (route.method !== '*' && route.method !== method.toUpperCase()) continue;
    if (route.regex.test(path)) return route.config;
  }
  return undefined;
}

// ── Payment extraction ─────────────────────────────────────────────

function extractPaymentPayload(req: Request): any | null {
  // Check x402 Authorization header: "x402 <base64>"
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('x402 ')) {
    try {
      const data = authHeader.substring(5);
      return JSON.parse(Buffer.from(data, 'base64').toString());
    } catch {
      return null;
    }
  }

  // Check X-Payment header (alternative)
  const paymentHeader = req.headers['x-payment'] as string | undefined;
  if (paymentHeader) {
    try {
      return JSON.parse(Buffer.from(paymentHeader, 'base64').toString());
    } catch {
      return null;
    }
  }

  // Check payment-signature header (x402 v2 standard)
  const sigHeader = req.headers['payment-signature'] as string | undefined;
  if (sigHeader) {
    try {
      return JSON.parse(Buffer.from(sigHeader, 'base64').toString());
    } catch {
      return null;
    }
  }

  return null;
}

// ── Middleware factory ──────────────────────────────────────────────

/**
 * Create Express middleware that protects routes with Agent Pay payments.
 *
 * The middleware intercepts requests to configured routes, returns 402 if no
 * payment is present, verifies payments, settles them, and then calls next().
 * After verification, `req.agentPayPayment` contains the payment details.
 *
 * @param config - Middleware configuration
 * @returns Express middleware function
 */
export function agentPayMiddleware(
  config: AgentPayMiddlewareConfig,
): (req: Request, res: Response, next: NextFunction) => void {
  // Validate config
  if (!config.networks || config.networks.length === 0) {
    throw new ValidationError('networks must be a non-empty array');
  }
  if (!config.routes || Object.keys(config.routes).length === 0) {
    throw new ValidationError('routes must be a non-empty object');
  }

  const compiledRoutes = compileRoutes(config.routes);

  // Lazy-initialize the x402 server on first request
  let serverPromise: Promise<x402ResourceServer> | null = null;

  function getServer(): Promise<x402ResourceServer> {
    if (!serverPromise) {
      const apServer = createAgentPayResourceServer({
        agentPayBaseUrl: config.agentPayBaseUrl,
        agentPayId: config.agentPayId,
        signingKeys: config.signingKeys,
        serviceUrl: config.serviceUrl,
        agentPayAuth: config.agentPayAuth,
      });

      for (const network of config.networks) {
        apServer.registerNetwork(network);
      }

      serverPromise = apServer.initialize({
        disableDefaultFallback: config.disableDefaultFallback,
      });
    }
    return serverPromise;
  }

  function sendError(res: Response, status: number, message: string, details?: string) {
    res.status(status).json({
      error: message,
      ...(details ? { details } : {}),
    });
  }

  return function agentPayMw(req: Request, res: Response, next: NextFunction) {
    const routeConfig = matchRoute(compiledRoutes, req.method, req.path);

    // Not a protected route — pass through
    if (!routeConfig) {
      return next();
    }

    // Async handler
    (async () => {
      const server = await getServer();
      const paymentPayload = extractPaymentPayload(req);

      if (!paymentPayload) {
        // No payment — return 402
        const requirements = await server.buildPaymentRequirements({
          scheme: 'aws:base',
          network: routeConfig.network,
          payTo: routeConfig.payTo,
          price: routeConfig.price,
          extra: {
            ...(routeConfig.description && { description: routeConfig.description }),
            ...(routeConfig.dimensions && { dimensions: routeConfig.dimensions }),
            ...routeConfig.extra,
          },
        });

        const paymentRequired = await server.createPaymentRequiredResponse(
          requirements,
          {
            url: `${config.serviceUrl}${req.path}`,
            description: routeConfig.description || `Access to ${req.path}`,
            mimeType: routeConfig.mimeType || 'application/json',
          },
        );

        const acceptsBase64 = Buffer.from(JSON.stringify(paymentRequired)).toString('base64');
        return res
          .status(402)
          .set('WWW-Authenticate', `x402 version=${paymentRequired.x402Version}, accepts="${acceptsBase64}"`)
          .json(paymentRequired);
      }

      // Payment present — verify
      const accepted = paymentPayload.accepted;
      if (!accepted) {
        return sendError(res, 400, 'Invalid payment', 'Missing accepted requirements in payment payload');
      }

      const verifyResult = await server.verifyPayment(paymentPayload, accepted);
      if (!verifyResult.isValid) {
        return sendError(res, 402, 'Payment verification failed', verifyResult.invalidReason);
      }

      // Build payment info
      const apPayload = paymentPayload.payload;
      const payment: PaymentInfo = {
        payer: verifyResult.payer || 'unknown',
        transactionId: apPayload?.transactionId || '',
        network: accepted.network,
        amount: accepted.amount,
        asset: accepted.asset,
      };

      // Call onPaymentVerified hook
      if (config.onPaymentVerified) {
        await config.onPaymentVerified(req, payment);
      }

      // Agent Pay auto-captures during CreateAgentPayment — no settle call needed.
      if (config.onPaymentSettled) {
        await config.onPaymentSettled(req, payment, payment.transactionId);
      }

      // Attach payment info to request and proceed
      req.agentPayPayment = payment;
      next();
    })().catch((err) => {
      if (config.onError) {
        config.onError(err, req, res);
      } else {
        console.error('[agent-pay-middleware] Error:', err);
        sendError(res, 500, 'Internal server error', err instanceof Error ? err.message : String(err));
      }
    });
  };
}
