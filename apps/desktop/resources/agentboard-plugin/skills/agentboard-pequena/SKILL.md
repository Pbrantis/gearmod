---
name: agentboard-pequena
description: Faz uma tarefa pequena do AgentBoard do começo ao fim com um agente só (implementa e valida), sem Especificação, Plano, Tasks nem etapa de teste separada. Use quando o AgentBoard pedir para fazer a tarefa pequena.
---

# Tarefa pequena (AgentBoard)

Este card é uma tarefa pequena: uma alteração localizada. Um agente só faz tudo, para gastar menos. O contexto traz só o título e a descrição do que fazer; não existem Especificação, Plano nem Tasks.

1. Leia o que for preciso do projeto (só o que a tarefa toca) e faça a alteração na worktree atual, preservando mudanças existentes.
2. Valide o que você mudou: rode os testes, o lint e o typecheck do projeto e revise o seu diff. Corrija o que falhar.
3. Ao terminar, atualize o Resumo com `agentboard_escrever_documento` (tipo `resumo`): mantenha o texto original e acrescente uma seção "Resultado" com o que mudou, como foi validado e o que ficou pendente, se ficou.
4. Faça só o que a descrição pede. Se a tarefa se mostrar maior do que parecia (vários módulos, decisões de design, risco real), pare e diga isso ao usuário em vez de seguir: ela merece um planejamento completo.
5. Se tiver uma dúvida que só o usuário resolve, pergunte na conversa (opções fechadas com o bloco `agentboard-perguntas`) e espere.
6. Não mova o card de coluna: isso é com o usuário.
