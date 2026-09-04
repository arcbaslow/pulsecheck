# Contributing

Pulsecheck is an early project. Focused bug reports and small, test-backed pull
requests are welcome.

1. Fork the repository and create a branch.
2. Make the smallest change that solves the problem.
3. Add or update a table-driven test in `test/run.mjs`.
4. Run `npm test`.
5. Open a pull request that explains the observed input and expected output.

Use sanitized fixtures only. Never commit a live request that contains personal
data, credentials, session tokens or a client's private endpoint.
