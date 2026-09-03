# Security

## Secrets

The Discord webhook URL grants permission to post to its channel. Treat it like a password.

- Keep it in `.env` or a file under `.secrets/`.
- Never place it in configuration JSON, source code, screenshots, logs, issues, or commits.
- Rotate the webhook immediately if it is exposed.
- Keep the secret directory and file readable only by the service account.

Before publishing, verify ignored files and scan staged content:

```sh
git status --ignored --short
git grep -nE 'discord(app)?\.com/api/webhooks/' -- ':!README.md' ':!.env.example'
```

The second command should find no real webhook. The placeholders in documentation and `.env.example` are intentional.

## Reporting a vulnerability

Please report security issues privately to the repository owner rather than opening a public issue. Include a minimal reproduction and avoid attaching real webhook URLs or monitor state.
