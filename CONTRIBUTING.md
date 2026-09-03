# Contributing

Contributions are welcome. Keep changes focused and include tests for delivery, deduplication, parsing, or migration behavior.

```sh
npm install
npm test
npm run check
```

Use synthetic summoner names, match IDs, PUUIDs, and webhook URLs in tests and documentation. Do not commit scraped player data, production state, browser profiles, or credentials.

OP.GG markup can change without notice. Parser changes should preserve the fail-closed behavior: if required fields cannot be proven, send nothing and leave durable state unchanged.
