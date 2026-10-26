---
name: agentboard-implementar
description: Implementa um card do AgentBoard seguindo o Plano e as Tasks do contexto, na worktree do card. Use quando o AgentBoard pedir para implementar o card.
---

# Implementar card (AgentBoard)

Implemente este card seguindo o Plano e as Tasks do contexto, na worktree atual.

- Preserve mudanças existentes. Escreva os testes automatizados que cada task pede junto com o código.
- **Regra de pronto** (vale para toda task, não é uma task): antes de entregar, rode lint, type-check e os testes da área que você alterou, e corrija o que falhar. A suíte inteira, as regressões e a validação na tela são do testador, pelo Plano de testes.
- Marque com `agentboard_marcar_task` cada critério de aceite assim que o cumprir e cada task assim que terminar, na hora (não deixe para o fim): o usuário acompanha as Tasks ao lado do chat. Ao terminar, atualize o Resumo com `agentboard_escrever_documento` (status, progresso e próximo passo).
- Commit: nunca rode `git commit` direto. Peça com `agentboard_pedir_commit` (mensagem curta em português, no imperativo; `arquivos` só se o commit não for de tudo). A regra do projeto está no campo `commit` do contexto: se for "pedir permissão", o usuário autoriza no card e você segue com o que não depende do commit; se for "não faça commit", deixe as alterações na worktree.
- Os documentos do card são o contrato entre as etapas: implemente o que está neles e nada além.
- Se algo fora dos documentos for necessário (escopo novo, requisito, refatoração extra), NÃO faça: registre com `agentboard_propor_mudanca` e continue só com o que está nos documentos. O usuário autoriza antes de qualquer alteração.
- Se tiver uma dúvida que os documentos não respondem, registre com `agentboard_perguntar_ao_planejador`, continue só com o que não depende dela e termine a execução: o app leva a dúvida ao planejador e te retoma com a resposta.
- Não mova o card de coluna: isso é com o usuário.

- **Reavaliação:** se a implementação exigir mudança arquitetural, revelar dependência nova ou falhar repetidamente pelo mesmo motivo, reavalie com `agentboard_avaliar_complexidade` (gatilho `architecture`, `new-dependency` ou `failures`) antes de seguir. Decisões técnicas relevantes que você tomou: `agentboard_registrar_decisao` com origem agente.
