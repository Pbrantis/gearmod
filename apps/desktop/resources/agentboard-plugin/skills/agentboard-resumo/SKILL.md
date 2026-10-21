---
name: agentboard-resumo
description: Escreve o documento Resumo de um card do AgentBoard. Use ao terminar o planejamento, ao pausar e ao terminar uma execução, para dizer em poucas linhas o que o card é, em que pé está, o progresso das tasks e o próximo passo.
---

# Documento: Resumo

O Resumo é o que o usuário lê primeiro, no card do quadro e ao abrir o card. Ele diz o que está acontecendo agora. É o único documento que não vem do Spec Kit: ele resume os outros três.

## Idioma

Escreva no idioma informado em `idioma`. Use `templates/<idioma>.md`; se não houver, traduza `templates/pt-BR.md`, incluindo os rótulos.

## Regras

- **Status:** um destes: Rascunho, Plano pronto, Executando, Pausado, Concluído (traduzidos para o idioma).
- **Texto:** 2 a 4 frases, até 600 caracteres: o que muda para quem usa, por que importa e o que falta. Não repita a Especificação nem liste arquivos.
- **Histórias:** uma linha com as histórias e prioridades (ex.: "H1 Editar documentos (P1) · H2 Contar tasks (P2)").
- **Progresso:** "x de y tasks concluídas", contando só as tasks de primeiro nível do documento Tasks.
- **Próximo passo:** uma ação concreta e de quem é ("Você: revisar as tasks", "Agente: executar a Fase 2").
- Se ainda houver `[PRECISA ESCLARECER]` na Especificação, diga isso no texto.
- Reescreva o Resumo inteiro a cada atualização; ele sempre reflete o estado atual.

## Entrega

Envie com `tipo` = `resumo` (ferramenta `agentboard_escrever_documento` ou marcadores, conforme `agentboard-planejamento`).
