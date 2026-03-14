# HY Exception Hygiene (HY-16 / HY-17)

## Purpose

Govern hygiene waivers and emergency bypasses with explicit scope, expiry, and debt visibility.

## Schema

`hygiene:exception:sync` defines:
- `HygieneExceptionPolicy`
- `HygieneException` records (from `config/hygiene-exceptions.json`)

Required exception fields:
- `reason`
- `approver`
- `expiresAt`
- one of `scope` or `scopePattern`
- `decisionHash`

Types:
- `standing_waiver`
- `emergency_bypass`

## Verification

`hygiene:exception:verify`:
- flags expired active exceptions
- flags invalid exception records (missing required fields / invalid type)
- emits exception hygiene debt snapshot (`HygieneMetricSnapshot`)
- advisory-first by default (`HYGIENE_EXCEPTION_ENFORCE=false`)

## Files

- Config input: `config/hygiene-exceptions.json`
- Artifacts: `artifacts/hygiene/hygiene-exception-verify-*.json`

## Commands

```bash
cd /home/jonathan/.openclaw/workspace/codegraph
npm run -s hygiene:exception:sync
npm run -s hygiene:exception:verify
```
