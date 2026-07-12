# Damasio OS Core Rules — V51.1

1. Every operational record belongs to exactly one `company_id`.
2. `organization_id` is temporary compatibility only and must always match `company_id`.
3. Admins and employees never read or modify another company’s data.
4. Master sees company summaries by default; operational data requires active, temporary, audited authorization.
5. Master access levels are `read_only`, `operational_support`, and `full_temporary`.
6. Every Master session expires automatically and can be revoked immediately.
7. Customer → Property → Quote → Job → Schedule → Dispatch → Route → Visit → Feedback → Task → History uses one shared data source.
8. Records are archived or deactivated instead of being silently destroyed when history matters.
9. Important mutations must create an audit record.
10. Desktop layout is never changed without authorization.
11. Bugs and integration regressions take priority over new features.
12. Every release must pass TypeScript and production build before being called production-ready.
