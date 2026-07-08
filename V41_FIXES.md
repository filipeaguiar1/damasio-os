# Damasio OS V41 Fix Pack

Correções principais aplicadas sobre a V40:

- Employee Service Issues agora mostra somente tasks abertas/in progress. Tasks resolvidas saem imediatamente da tela do Employee.
- Mark Resolved usa fluxo real de resolução, registra histórico, notificação e sync local.
- Start Return Visit agora muda a task para in_progress, conecta ao Property correto, inicia sessão/timer real e abre a Service Screen.
- Open Service Screen agora tenta resolver a propriedade por id, endereço ou nome do cliente, evitando cards sem dados.
- Get Directions agora abre Google Maps em modo rota/directions com destination, e não apenas busca genérica.
- Botão de directions só aparece quando existe endereço válido; caso contrário exibe aviso claro.
- Property Profile do Employee agora mostra cliente, telefone, email, endereço, serviço e dados da property.
- Fotos oficiais da property aparecem também na Service Screen.
- Timer foi mantido persistente por localStorage e recalculado a cada segundo enquanto está running.

Observação: esta versão ainda usa localStorage/mock storage. A próxima fundação real deve ser Supabase/Auth/RLS.
