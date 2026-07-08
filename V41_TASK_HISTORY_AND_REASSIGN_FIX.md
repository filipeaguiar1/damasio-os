# V41 Task History + Reassign Fix

Correções aplicadas:

- Corrigida a tela de Task History para o comentário do cliente não ser cortado/coberto.
- Histórico agora mostra dois blocos claros:
  - Customer issue
  - What was done
- Adicionado botão principal **Ver o que foi feito** no histórico.
- Página de detalhe da task agora mostra o que o Employee/Admin fez na casa.
- Ao resolver uma task, o sistema pede uma nota do que foi feito.
- Admin agora tem botão **Remove from Employee / Return to Admin** nas tasks atribuídas.
- Quando removida, a task sai do Employee/Crew e volta para Waiting for Admin, podendo ser enviada para outro trabalhador.
- Layout de Open Tasks e Task History reforçado para telas grandes e pequenas.
- TypeScript validado com `npx tsc --noEmit`.
