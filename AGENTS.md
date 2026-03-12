# AGENTS.md

## Verification

- After any code change, always run these commands in this repository before finishing:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run verify`
- If any command fails, fix the issue when possible and rerun the failed command.
- In the final response, report whether each command succeeded or failed.

## Notes

- `npm run verify` already includes lint, typecheck, and build, so running all three is intentionally redundant in this repository.
