---
inclusion: always
---

# Rules of Engagement

## Process

- Follow the Spec-Driven Development process defined in #[[file:docs/sdd-process.md]]
- The spec file (`docs/spec.md`) must always reflect the current implementation state. If you change code, update the spec in the same pass.
- Update `docs/tasks.md` when completing or adding tasks.
- Never leave documentation out of sync with code.

## Verification

- Always run `npx tsc --noEmit`, `npx vitest run`, and `npx tsup` before declaring work complete.
- Verify examples still load after any code change.
- After renames or refactors, grep the entire codebase to confirm zero remaining references to the old term.
- Do not declare success based on assumptions — run the commands and show the output.

## Commits

- Never commit without explicit user approval.
- Use conventional commit messages (feat:, fix:, refactor:, docs:, test:).
- Include a summary of what changed in the commit body.

## Naming & Terminology

- The product is "Agentic Pay" (or "AWS Marketplace Agent Pay" in full).
- Never use "FAB", "Federated Application Billing", or "wallet" in new code or documentation.
- The x402 scheme identifier is `aws:marketplace`.
- The network identifier is `aws:marketplace` — use the `DEFAULT_NETWORK` constant, never a magic literal.
- The package is `@x402/aws-agentic-pay`.
- Use "allowlist" not "whitelist", "blocklist" not "blacklist".

## Code Style

- Prefer ES384 for payment token signing (matches Agent Pay production).
- Agent Pay auto-captures on creation — there is no separate capture/settle step.
- The `settle()` function is a no-op that returns success immediately.
- Use `agenticPay` (camelCase) for variables, `AgenticPay` (PascalCase) for types/classes, `agentic-pay` (kebab-case) for file names.
- Keep the `DEFAULT_NETWORK` constant as the single source of truth for the network string.

## API Contract

- The mock server must match the exact AWS Marketplace Agent Pay API signature (2026-04-20):
  - `POST /CreateAgentPayment` — `{ quoteToken, clientToken?, dpopJwk? }` → `{ paymentId, paymentToken, createdAt }`
  - `GET /GetAgentPayment/{paymentId}` — full payment detail
  - `POST /ListAgentPayments` — paginated list
- Payment ID format: `awsmp-{UUID}` (42 chars)
- Auth: AWS SigV4
- DPoP: EC keys only (P-256, P-384, P-521), passed as `dpopJwk` in request body

## Testing

- All new functionality must have unit tests.
- Integration tests must mock the service JWKS endpoint (quote token verification is mandatory).
- Use `createMockAgenticPayClient()` from test helpers for unit tests.
- Target: 90%+ coverage across all metrics.
