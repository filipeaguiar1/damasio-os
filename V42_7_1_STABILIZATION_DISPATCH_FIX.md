# Damasio OS V42.7.1 — Stabilization & Dispatch Fix

Base: V42.7 — Operations Intelligence

## Objetivo

Esta versão corrige o problema operacional principal identificado nos testes: funções existiam, mas o fluxo não estava claro ou confiável para o Admin usar no dia a dia.

Foco desta versão:

- Tasks visíveis e administráveis pelo Admin.
- Criação manual de Tasks/Return Visits.
- Assign/Reassign de Tasks para Crew/Employee.
- Schedule & Dispatch com fluxo claro para criar rota com várias casas.
- Data escolhida pelo Admin agora define automaticamente o `serviceDay` usado em Routes e Employee Route.
- Criação de rota em lote para 20+ casas.
- Histórico e Workflow continuam recebendo eventos.

## Principais mudanças

### Schedule & Dispatch

A página `/admin/schedule` agora é o local oficial para criar rotas.

Fluxo:

1. Selecionar casas.
2. Escolher data.
3. Escolher janela.
4. Escolher funcionário/crew.
5. Clicar em `Create Route`.
6. Abrir `/admin/routes` para revisar.
7. Abrir Employee Route para testar visão de campo.

### Tasks

A página `/admin/tasks` deixou de depender somente de consultas externas e agora usa o Operational Task Center local do app para garantir que o Admin consiga ver e testar as tasks.

Incluído:

- criar task;
- escolher property;
- prioridade;
- funcionário/crew;
- data;
- resolver task;
- histórico de resolvidas.

### Storage / Workflow

Atualizações em `lib/storage.ts`:

- `scheduleLead` agora atualiza `serviceDay` automaticamente pela data.
- novo `scheduleRouteBatch` para criar rotas em lote.
- novo `createAdminTask` para return visits criadas pelo Admin.

## Regra preservada

Layout geral não foi redesenhado. As mudanças foram focadas em clareza operacional e funcionamento real.
