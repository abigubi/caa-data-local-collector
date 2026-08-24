# Security and responsible operation

This project is intended for authorized, limited research lookups on specific exhibit tickers. It is not designed to create a bulk market-data database.

## Never commit local state

The repository excludes the following by default:

- browser profiles, cookies, and sessions;
- cached fund or REIT data;
- `config.json`, which may contain a contact identity;
- local certificates and private keys;
- temporary source documents.

Before any push, run `git status --short --ignored` and verify that these remain ignored.

## Source protection

Do not add stealth browser modifications, automated CAPTCHA solving, proxy rotation, cookie extraction, or code intended to defeat source security controls. If a provider requests verification, complete it manually. If a provider returns 403, 429, or 503, allow the built-in circuit breaker to stop collection.

The preferred provider-side arrangement is written authorization plus IP allowlisting or a narrowly scoped access token.

## Reporting a problem

Do not open a public issue containing cache data, cookies, source responses, contact identities, or workbook contents. Use a private repository issue with redacted diagnostics.
