# Damasio OS — Quality Checklist

Before any version is considered ready:

- The project installs from the public npm registry.
- The project compiles without TypeScript errors.
- Existing demo login still works unless intentionally replaced.
- Existing navigation is not broken.
- Buttons must open the correct screen or clearly show why the action is unavailable.
- Employee must not access financial data.
- Customer must only access their own data.
- Admin must have a clear next action on each operational screen.

## V42.0 completion criteria

- `.env.example` exists and is clear.
- `.npmrc` points to public npm.
- Supabase client is centralized.
- SQL setup is idempotent.
- Health check exists for visible database testing.
- No company signup/onboarding is forced.
