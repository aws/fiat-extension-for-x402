// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Configuration types for Agentic Commerce scheme registration
 */

/**
 * Service signer interface (for custom implementations)
 */
export interface QuoteSigner {
  signQuote(payload: unknown): Promise<string>;
  getPublicKey(): unknown;
  getServiceUrl(): string;
}
