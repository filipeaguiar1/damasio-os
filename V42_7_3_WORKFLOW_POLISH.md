# Damasio OS V42.7.3 — Workflow Polish

Base: V42.7.2 Visible Dispatch Fix

## Objetivo
Corrigir problemas visíveis do fluxo operacional antes de adicionar novos módulos.

## Alterações

### Employee Route
- Cronômetro ficou mais claro com status NOT STARTED / IN PROGRESS / DONE.
- Ao finalizar uma casa, aparece confirmação `Done`.
- Botão Comment agora abre campo com ações Save Comment e Cancel.
- Comentários são salvos na sessão e aparecem como Completion Comment.
- Botão Photo agora abre seletor real de arquivo/imagem.
- No celular, o input usa `accept=image/*` e `capture=environment`, permitindo câmera ou galeria conforme o navegador.
- Fotos são salvas no histórico local da casa como Data URL, com limite de 5 fotos.

### Dispatch / Schedule
- Casas já atribuídas a uma rota ficam bloqueadas.
- Casas bloqueadas aparecem esmaecidas com informação de crew/data.
- Checkboxes de casas já atribuídas ficam desativados.
- `Select Available` seleciona somente casas que ainda não estão em rota.
- `Create Route` pula automaticamente casas bloqueadas e informa o resultado.
- `Assign` individual também respeita o bloqueio.

### Storage / Workflow
- Adicionada função `isLeadAvailableForRoute`.
- `scheduleLead` agora retorna boolean e impede duplicidade de rota.
- `scheduleRouteBatch` agora agenda apenas casas disponíveis.
- Adicionada função `saveServiceComment`.

## QA
- TypeScript: aprovado.
- Build: compilou com sucesso.
- Layout geral: preservado.

## Observação
Esta versão foca em estabilizar o fluxo real de campo. Não adiciona grandes módulos novos.
