// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
// Fixture for test/api/public-api.test.ts: values re-exported as types, a
// let binding, a destructured const, a const enum and a namespace that
// holds only types.
import type { AgenticCommerceVerifier } from '../../../src/agentic-commerce';

export type { LocalQuoteSigner as TypeOnlyClass } from '../../../src/signers';
export { type KmsQuoteSigner as InlineTypeOnly } from '../../../src/signers';
export { jwksDocument as ValueFunction } from '../../../src/agentic-commerce';
export { AgenticCommerceVerifier as ImportedTypeOnly };

export let mutableBinding: number | undefined;
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace TypeNamespace {
  export interface OnlyAType {
    value: string;
  }
}

export const { destructuredConst } = { destructuredConst: 1 };

export const enum ConstEnumOnly {
  A = 'a',
}
