// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * An Express seller on x402's stock `paymentMiddleware`, with the `exact`
 * Agentic Commerce scheme and a facilitator running in the same process.
 *
 * `createSellerApp` builds the app and does not listen; `server.ts` loads the
 * key from the environment and starts it.
 */
import express, { type Express } from 'express';
import { paymentMiddleware } from '@x402/express';
import { x402Facilitator } from '@x402/core/facilitator';
import { type RoutesConfig, x402ResourceServer } from '@x402/core/server';
import {
  AgenticCommerceVerifier,
  ExactAgenticCommerceFacilitatorScheme,
  InProcessFacilitatorClient,
  jwksDocument,
  registerExactAgenticCommerceServer,
  type DPoPNonceStore,
  type LocalQuoteSigner,
  type SellerKeyResolver,
} from '@aws/fiat-extension-for-x402';

export interface SellerAppOptions {
  /** Signs the quote tokens. Its public key is served at /.well-known/jwks.json. */
  signer: LocalQuoteSigner;
  /** Your AWS Marketplace product ID, signed into each quote. */
  productId: string;
  /**
   * Where the facilitator finds your quote-signing key. Defaults to the
   * signer's own public key, since the facilitator runs in this process.
   */
  sellerKeyResolver?: SellerKeyResolver;
  /** Base URL of the payment service's JWKS. Defaults to the production endpoint. */
  paymentTokenJwksUrl?: string;
  /** Rejects replayed DPoP proofs. Share one store across all instances. */
  dpopNonceStore?: DPoPNonceStore;
}

export function createSellerApp(options: SellerAppOptions): Express {
  const { signer, productId } = options;

  // Facilitator: verifies each payment token against the quote it pays for,
  // with the seller key configured here (never one named by the token).
  const verifier = new AgenticCommerceVerifier({
    sellerKeyResolver: options.sellerKeyResolver ?? {
      type: 'static',
      publicJwk: signer.publicJwk,
    },
    paymentTokenJwksUrl: options.paymentTokenJwksUrl,
  });
  const facilitator = new x402Facilitator().register(
    'aws:base',
    new ExactAgenticCommerceFacilitatorScheme({ verifier })
  );

  // Resource server: signs a quote into every 402 and checks DPoP proofs.
  const resourceServer = registerExactAgenticCommerceServer(
    new x402ResourceServer(new InProcessFacilitatorClient(facilitator)),
    { signer, dpopNonceStore: options.dpopNonceStore }
  );

  const routes: RoutesConfig = {
    'GET /weather': {
      accepts: {
        scheme: 'exact',
        network: 'aws:base',
        payTo: productId, // signed into the quote as payTo and settlement.product_id
        price: '$0.01',
        extra: { description: 'Current weather', reference: 'weather-v1' },
      },
      description: 'Current weather',
      mimeType: 'application/json',
    },
  };

  const app = express();

  // The public half of the quote-signing key, built once. Not a paid route.
  const jwks = jwksDocument(signer.publicJwk);
  app.get('/.well-known/jwks.json', (_req, res) => {
    res.json(jwks);
  });

  // Express answers HEAD with the GET handler, and @x402/core before 2.29
  // matches the method exactly, so there the route protects GET only. From
  // 2.29 a GET route covers HEAD too. Refuse HEAD ahead of the payment
  // middleware, so every supported @x402/core answers it the same way.
  app.head('/weather', (_req, res) => {
    res.set('Allow', 'GET').sendStatus(405);
  });

  // Express 4 ignores the promise a handler returns, so pass a rejection on.
  const payments = paymentMiddleware(routes, resourceServer);
  app.use((req, res, next) => {
    payments(req, res, next).catch(next);
  });

  app.get('/weather', (_req, res) => {
    // A paid response must never be served from a shared cache.
    res.set('Cache-Control', 'private, no-store');
    res.json({ city: 'Seattle', temperatureF: 58, conditions: 'cloudy' });
  });

  return app;
}
