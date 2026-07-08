# Damasio OS V50.1 — Production Stabilization

Objetivo: estabilizar build, TypeScript, pnpm/Node e Vercel sem alterar layout e sem criar novos módulos.

Correções aplicadas:
- `lib/pricing.ts` agora exporta `QuoteSizeKey` canônico.
- `QuoteSizeKey` aceita `xs`, `small`, `medium`, `large`, `legacy`, `oversize` para compatibilidade com telas antigas.
- `medium` funciona como alias de `small`.
- `large` funciona como alias de `legacy`.
- `calculateQuote()` agora recebe `QuoteSizeKey`, eliminando erro `SizeKey is not assignable to QuoteSizeKey`.
- `LawnSize` foi alinhado com os mesmos tamanhos para evitar novos conflitos entre Storage, Quote e UI.
- `package.json` padronizado para pnpm, Node 20 e Vercel.
- `package-lock.json` removido para evitar conflito npm/pnpm.

Layout: não alterado.
Novos módulos: nenhum.
