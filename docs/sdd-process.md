# SDD Collaboration Process — FAB x402 Extension

**Applies to:** `@x402/fab` development  
**Methodology:** Spec-Driven Development (SDD), targeting spec-as-source  
**Last Updated:** 2026-03-05

---

## 1. What is SDD?

SDD is a three-level framework for AI-assisted development:

| Level | Description | Spec Lifecycle | Code Edits |
|-------|-------------|----------------|------------|
| Spec-first | Write spec, AI generates code, spec discarded | Disposable | Any |
| Spec-anchored | Spec committed and maintained; code editable as fallback | Persistent | Allowed after 2 failed spec-driven attempts |
| Spec-as-source | Spec is the single source of truth; code is generated, never hand-edited | Persistent | Not allowed |

Our north star is spec-as-source. We accept spec-anchored when spec-as-source fails after 2 tries.

## 2. Spec Structure

The project maintains two levels of specification:

### System Spec (`docs/spec.md`)
- Business context and domain model
- Personas and their interactions (API providers, API consumers, wallet providers)
- All requirements in EARS syntax, validated against INCOSE guidelines
- Non-functional requirements (performance, security, compatibility, testability)
- Correctness properties (formal invariants for property-based testing)

### Task Specs (`docs/tasks.md`)
- Define how to move the system spec from state A to state B
- Include updates to system specs, code, and related tests
- Track implementation status against spec requirements
- Contain the traceability matrix (spec → source → tests)

## 3. Collaboration Flow

### Starting New Work

1. Update `spec.md` first — define or modify requirements using EARS syntax
2. Create or update task entries in `tasks.md` referencing the new spec requirements
3. AI generates code and tests from the spec
4. Verify generated output against spec acceptance criteria
5. Commit spec + generated code + tests together

### Modifying Existing Behavior

1. Update the requirement(s) in `spec.md`
2. Add a task entry in `tasks.md` describing the state transition
3. Regenerate affected code and tests
4. Verify traceability: every requirement maps to source and test files

### Rules

- No code until the spec is in the repo
- Every feature is traceable: spec → tests → code → deployment
- Bad agent output means missing context — fix the spec, not the prompt
- Specs evolve with the product; they are not throwaway documents

## 4. Quality Gates

### Spec Quality (EARS + INCOSE Checklist)

Every requirement in `spec.md` shall:

- [ ] Use active voice with "shall" for mandatory behavior
- [ ] Follow one of the EARS patterns (ubiquitous, event-driven, state-driven, optional, unwanted behavior, complex)
- [ ] Be atomic — one mandatory action per requirement
- [ ] Be verifiable — measurable or testable
- [ ] Avoid ambiguous terms ("user-friendly", "fast", "approximately")
- [ ] Have a unique identifier (e.g., FAB-SRV-001)
- [ ] Be traceable to source files and test files

### Code Quality

- 90%+ coverage (line, function, branch) — enforced in `vitest.config.ts`
- TypeScript strict mode, no compilation errors
- All tests passing before merge
- Correctness properties validated via property-based tests

### Traceability

The traceability matrix in `tasks.md` maps every requirement ID to:
- Design section in `design.md`
- Source file(s) implementing the requirement
- Test file(s) verifying the requirement

## 5. Roles

| Role | Contribution to this project |
|------|------------------------------|
| PMT / Domain Lead | Functional specs: domain model, APIs, acceptance criteria in `spec.md` |
| SDE / Builder | Design specs in `design.md`, task breakdown in `tasks.md`, code review |
| AI Agent | Code generation from specs, test generation, iteration until checks pass |
| Human Reviewer | Defines the harness (tests, linters, validation), reviews results — not every intermediate step |

## 6. Metrics We Track

| Metric | Target |
|--------|--------|
| Spec-as-source rate | 80%+ of features |
| Manual code edits | <10% of generated code |
| Test coverage | 90%+ across all modules |
| Correctness properties | All 15 properties validated |
| Traceability | 100% of requirements mapped to source + tests |

## 7. File Map

```
docs/
├── spec.md          ← System spec (EARS requirements, decisions, rationale — source of truth)
├── tasks.md         ← Task specs (implementation plan, status, traceability)
└── sdd-process.md   ← This document (collaboration process)
```

## 8. When Things Go Wrong

- If AI generates incorrect code → check if the spec is ambiguous or incomplete. Fix the spec first.
- If spec-as-source fails after 2 attempts → fall back to spec-anchored (edit code, document deviation in tasks.md).
- If a requirement is untestable → rewrite it to be measurable per INCOSE guidelines.
- If traceability breaks → update the matrix in tasks.md before proceeding.
