# Contributing

Thanks for improving 乔木 HN 速读.

## Local Checks

```bash
npm ci
npm run build
SMOKE_BASE_URL=http://127.0.0.1:3000 npm run smoke:api
```

For UI changes, also verify the reader in a browser on desktop and mobile widths.

## Pull Requests

- Keep changes focused.
- Do not commit `.env`, `.data`, screenshots with private data, or provider keys.
- Use lucide icons for new UI icons.
- Keep public UI Chinese-first and avoid exposing provider/model/debug wording unless it is an admin or docs surface.
- Mention any HNRSS or DeepSeek behavior that could affect live operation.
