// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Shared GitHub workflow-command output for the CI check scripts, so file
// content can never inject runner commands.
// https://docs.github.com/actions/reference/workflow-commands-for-github-actions

const escapeData = (text) =>
  String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = (text) => escapeData(text).replace(/:/g, '%3A').replace(/,/g, '%2C');

// Prints one ::error annotation per problem and returns the problem count, so
// the caller can exit non-zero.
export const report = (problems) => {
  for (const { file, line, message } of problems) {
    const location = `file=${escapeProperty(file)}${line ? `,line=${line}` : ''}`;
    console.log(`::error ${location}::${escapeData(message)}`);
  }
  return problems.length;
};
