# 2026-07-08 Redesign Deployment Note

## Scope

- Apply qiaomu-design Phase 3 direction `C · 双语开发者流`.
- Preserve existing HNRSS / DeepSeek translation / iOS-ready API contracts.
- Keep production runtime as systemd service `hn-qiaomu` under `/opt/qiaomu-apps/hn-qiaomu`.

## Local Verification Before Deploy

- `npm run build`
- `npm run smoke:api`
- Playwright desktop and mobile render checks.

## Deployment Rules

- Sync only project source/runtime files.
- Do not delete or overwrite `/opt/qiaomu-apps/hn-qiaomu/.data`.
- Do not print or edit `/etc/qiaomu-apps/hn-qiaomu.env`.
- Restart `hn-qiaomu` after build on the VPS, then verify HTTPS and representative APIs.
