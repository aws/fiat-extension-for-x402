// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Where the verifier finds the seller's quote-signing public key.
 *
 * Follows the Python SDK's `fiat_extension_x402/agentic_commerce/keys.py`
 * (commit 62230e6). The key is always configured by the seller; it is never
 * discovered from the quote token itself.
 */

import type { GetPublicKeyCommand, GetPublicKeyCommandOutput } from '@aws-sdk/client-kms';
import type { JWK } from 'jose';

/** Credentials for the KMS `GetPublicKey` call */
export interface KmsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

/** The part of a KMS client the verifier uses */
export interface KmsPublicKeyClient {
  send(command: GetPublicKeyCommand): Promise<Pick<GetPublicKeyCommandOutput, 'PublicKey'>>;
}

/** Resolve the seller's public key from KMS with `kms:GetPublicKey`. */
export interface KmsSellerKeyResolver {
  type: 'kms';
  /** ARN of the seller's signing key */
  kmsKeyArn: string;
  /** Region hosting the key */
  region: string;
  /** Credentials for the KMS call. Omit to use the default AWS credential chain. */
  credentials?: () => Promise<KmsCredentials>;
  /** A pre-configured KMS client, used instead of creating one (useful for testing). */
  kmsClient?: KmsPublicKeyClient;
}

/** Resolve the seller's public key from the seller's own JWKS. */
export interface JwksSellerKeyResolver {
  type: 'jwks';
  /** Base URL. `/.well-known/jwks.json` is appended. */
  jwksUrl: string;
}

/** Use a public key the seller already holds. */
export interface StaticSellerKeyResolver {
  type: 'static';
  /** The seller's public key as a JWK */
  publicJwk: JWK;
}

/**
 * Strategy for locating the seller's quote-signing key. The key is always
 * configured by the seller, never discovered from the quote token itself.
 */
export type SellerKeyResolver =
  KmsSellerKeyResolver | JwksSellerKeyResolver | StaticSellerKeyResolver;
