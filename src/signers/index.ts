// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Quote token signers.
 */

export { KmsQuoteSigner, type KmsQuoteSignerConfig } from './kms';
export { LocalQuoteSigner, type FromPemOptions } from './local';
export type { QuoteSigner } from './protocol';
