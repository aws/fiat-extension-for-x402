# Contributing Guidelines

Thank you for your interest in contributing to our project. Whether it's a bug report, new feature, correction, or additional
documentation, we greatly value feedback and contributions from our community.

Please read through this document before submitting any issues or pull requests to ensure we have all the necessary
information to effectively respond to your bug report or contribution.

## Reporting Bugs/Feature Requests

We welcome you to use the GitHub issue tracker to report bugs or suggest features.

When filing an issue, please check existing open, or recently closed, issues to make sure somebody else hasn't already
reported the issue. Please try to include as much information as you can. Details like these are incredibly useful:

* A reproducible test case or series of steps
* The version of our code being used
* Any modifications you've made relevant to the bug
* Anything unusual about your environment or deployment

## Contributing via Pull Requests

Contributions via pull requests are much appreciated. Before sending us a pull request, please ensure that:

1. You are working against the latest source on the *main* branch.
2. You check existing open, and recently merged, pull requests to make sure someone else hasn't addressed the problem already.
3. You open an issue to discuss any significant work - we would hate for your time to be wasted.

To send us a pull request, please:

1. Fork the repository.
2. Modify the source; please focus on the specific change you are contributing. If you also reformat all the code, it will be hard for us to focus on your change.
3. Ensure local tests pass, and run `npm run format` so that the `npm run format:check` step in CI passes. One past commit reformatted the whole tree; run `git config blame.ignoreRevsFile .git-blame-ignore-revs` once so `git blame` skips it, as GitHub's blame view already does.
   If you change the package itself, `npm run check:package` builds it and runs the `attw` and `publint` checks that CI runs.
   `test/api/public-api.test.ts` freezes the names and kinds the package exports: adding, removing or renaming an
   export fails it until you update the snapshot with `npx vitest run test/api -u`. Removing or renaming an export is a
   breaking change. Signatures are not in the snapshot, so review them in the diff.
   `test/fixtures/cross-lang/` holds the shared wire fixtures that every SDK implementation of the scheme runs
   (`test/unit/cross-lang.test.ts` runs them here). They are the wire contract: never regenerate their fixed tokens,
   and make any change to them in every SDK at once. Their README describes the layout.
4. Commit to your fork using clear commit messages.
5. Send us a pull request, answering any default questions in the pull request interface.
6. Pay attention to any automated CI failures reported in the pull request, and stay involved in the conversation.

GitHub provides additional document on [forking a repository](https://help.github.com/articles/fork-a-repo/) and
[creating a pull request](https://help.github.com/articles/creating-a-pull-request/).

## Finding contributions to work on

Looking at the existing issues is a great way to find something to contribute on. As our projects, by default, use the default
GitHub issue labels (enhancement/bug/duplicate/help wanted/invalid/question/wontfix), looking at any 'help wanted' issues is a
great place to start.

## Releasing (maintainers)

Releases are published to [npm](https://www.npmjs.com/package/@aws/fiat-extension-for-x402) by
[`.github/workflows/release.yml`](.github/workflows/release.yml) using npm Trusted Publishing, so no npm
token is stored in the repository.

1. Open a pull request that sets the new `version` in `package.json` (and `package-lock.json`, with
   `npm version <version> --no-git-tag-version`) and adds an entry to [`CHANGELOG.md`](CHANGELOG.md) with the release date. Use a
   [semantic version](https://semver.org): `1.1.0` for a final release, `1.1.0-rc.1` for a pre-release.
2. After it merges, create a GitHub release from `main` with the tag `v<version>` (for example `v1.1.0` or
   `v1.1.0-rc.1`). Tick **Set as a pre-release** if, and only if, the version is a pre-release.
3. Publishing the release starts the workflow. It re-runs CI on the tag, checks that the tag is on `main`, that it
   matches `package.json` and that the pre-release setting matches the version, then builds and checks the package.
   Pre-releases are published with the `next` dist-tag, final versions with `latest`.
4. The publish to npm waits for approval in the `release` environment from a member of the maintainers team other
   than the person who published the release.

npm accepts each version only once. If a release is broken, publish a fixed version and
[deprecate](https://docs.npmjs.com/cli/commands/npm-deprecate) the broken one.

The npm trusted publisher for `@aws/fiat-extension-for-x402` is set to repository `aws/fiat-extension-for-x402`,
workflow `release.yml` and environment `release`. Renaming the workflow file or the environment breaks publishing
until the publisher on npm is updated to match.

## Code of Conduct

This project has adopted the [Amazon Open Source Code of Conduct](https://aws.github.io/code-of-conduct).
For more information see the [Code of Conduct FAQ](https://aws.github.io/code-of-conduct-faq) or contact
opensource-codeofconduct@amazon.com with any additional questions or comments.

## Security issue notifications

If you discover a potential security issue in this project we ask that you notify AWS/Amazon Security via our
[vulnerability reporting page](http://aws.amazon.com/security/vulnerability-reporting/). Please do **not** create a public
GitHub issue.

## Licensing

See the [LICENSE](LICENSE) file for our project's licensing. We will ask you to confirm the licensing of your contribution.
