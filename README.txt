Damasio OS V50.1 SizeKey Hotfix

Use this only if pnpm build fails with:
Type 'SizeKey' is not assignable to type 'QuoteSizeKey'
Type 'medium' is not assignable to type 'QuoteSizeKey'

How to apply:
1. Extract this ZIP.
2. Copy apply-sizekey-hotfix.ps1 into your project root: C:\Projetos\damasio-os
3. Open PowerShell in the project root.
4. Run:
   powershell -ExecutionPolicy Bypass -File .\apply-sizekey-hotfix.ps1
5. Then run:
   pnpm build

This patch does not change layout or add modules. It only aligns QuoteForm.tsx and lib/pricing.ts types.
