# Damasio OS V42.7.4 — Route Done + Demo Reset Fix

Base: V42.7.3 Workflow Polish

## Correções visíveis

- Employee Route agora mantém casas completas na rota e mostra o status **Done** no lugar de **Open**.
- Concluir uma casa não remove mais o card da tela do empregado.
- O texto de confirmação do Finish foi ajustado para “mark it as Done”, não “remove from route”.
- Load Demo agora recria dados fake quando usado manualmente, em vez de não fazer nada quando já existem dados no localStorage.
- Demo refeito com clientes/casas fake, endereços diferentes e rota de 9 casas para Crew A / Saturday.
- Casas em rota continuam bloqueadas para evitar duplicidade em outra rota.

## QA

- TypeScript: passou.
- Next build: passou.
- Layout geral preservado.
