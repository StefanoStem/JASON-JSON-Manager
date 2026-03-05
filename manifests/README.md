# Manifest and CSP

Extension pages use a strict Content Security Policy that **denies outbound connections** (`connect-src 'none'`) to align with the product’s local-only operation. Data stays in browser storage and is not sent over the network.

If a future feature requires a network exception, it must be explicitly allowed in the CSP and **documented here** (e.g. which endpoint, for what purpose, and how user data is protected).
