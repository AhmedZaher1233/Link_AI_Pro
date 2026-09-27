# `.mcp.json` fixtures for `scripts/selftest.mjs`

Placeholder hosts and names only (`devops.example.com`, `example-org`, `ExampleProject`) — never a real
organization, collection, project or token.

| File | Purpose |
|---|---|
| `cloud.mcp.json` | Microsoft `@azure-devops/mcp` entry (`${AZURE_DEVOPS_PAT_B64}`) + a legacy `word` server — the migration must remove `word`, add `docx` and leave `azure-devops` byte-identical |
| `self-hosted.mcp.json` | `@tiberriver256/mcp-server-azure-devops` entry (`${AZURE_DEVOPS_PAT}`, org URL, default project) + legacy `word` + an unpinned `docx` — same guard, plus the `pin:` action |
| `self-hosted-inline-pat.mcp.json` | a literal token typed into `AZURE_DEVOPS_PAT` — must be flagged as an inline secret |
| `cloud-inline-pat.mcp.json` | a literal base64 token typed into `PERSONAL_ACCESS_TOKEN` — must be flagged as an inline secret |

The harness copies each fixture into a temporary folder before calling `scanMcp`; the fixtures themselves
are never modified.
