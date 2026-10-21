---
name: agentboard-tasks
description: Escreve e atualiza o documento Tasks de um card do AgentBoard no estilo SDD (tasks T001 em fases, marcação [P] de paralelismo, rastreio para a história, caminhos de arquivo) com critérios de aceite dentro de cada task. Use no planejamento para dividir o Plano e na execução para marcar o que foi concluído.
---

# Documento: Tasks

As Tasks são o checklist que a execução segue. A estrutura segue o modelo de tasks do GitHub Spec Kit, enxuta para um card, com uma diferença do AgentBoard: **cada task carrega os seus critérios de aceite** (não existe outro documento de critérios). O número no card do quadro (ex.: 2/5) conta as tasks.

## Idioma

Escreva no idioma informado em `idioma`. Use `templates/<idioma>.md`; se não houver, traduza `templates/pt-BR.md`. Os IDs (`T001`, `[P]`, `[H1]`) seguem o modelo do idioma.

## Formato (obrigatório: o AgentBoard lê este formato)

- Título `## Tasks` no topo e uma seção `### Fase ...` por fase.
- Cada task é um item de **primeiro nível**:
  `- [ ] T001 [P] [H1] <verbo no infinitivo> <o quê> em \`<caminho/real>\``
  - `T001`: número sequencial, na ordem de execução, sem pular.
  - `[P]`: opcional; só quando a task mexe em arquivos diferentes das outras da fase e não depende delas.
  - `[H1]`: a história da Especificação que a task entrega (H1 = História 1). Tasks de preparação, base e acabamento não levam história.
- Os **critérios de aceite** da task ficam logo abaixo, recuados com 2 espaços:
  `  - [ ] <critério observável ou testável>`
- Cada fase termina com uma linha `**Ponto de verificação:** <o que deve funcionar aqui>`.

## Fases

1. **Preparação:** só se o card precisar (dependência, configuração).
2. **Base:** o que bloqueia as histórias (migração, contrato IPC, tipo compartilhado).
3. **Uma fase por história**, na ordem de prioridade (P1 primeiro; a fase da P1 é o MVP). Se a Especificação pede testes, as tasks de teste vêm antes da implementação e devem falhar antes dela.
4. **Acabamento:** limpeza, documentação, validação final do "Como validar" do Plano.

Para um card pequeno, use só as fases necessárias (às vezes uma só).

## Regras no planejamento

- Cobertura: todo `RF-xxx` e todo cenário de aceite da Especificação aparecem em ao menos um critério de alguma task.
- Cada task cabe numa sessão de trabalho, cita o caminho real do arquivo e pode ser verificada sozinha. Nada de "melhorar o código" ou "ajustar coisas".
- Cada task tem de 1 a 3 critérios. Critério é algo que se observa ou testa ("o diálogo mostra duas opções", "`pnpm test` passa"), nunca "funciona bem".
- Evite duas tasks [P] no mesmo arquivo e dependências entre histórias que quebrem a independência delas.

## Regras na execução

- Siga a ordem. Faça um commit por task ou por grupo lógico, se o projeto usar commits.
- Marque um critério com `[x]` só depois de verificar. Marque a task com `[x]` só quando todos os critérios dela estiverem marcados.
- Pare em cada **Ponto de verificação** e confirme que ele vale antes de seguir.
- Nunca apague tasks nem critérios. Trabalho novo vira task no fim da fase com o sufixo "(adicionada na execução)"; avise no chat.
- Se um critério não puder ser cumprido, deixe-o desmarcado e explique no chat.

## Entrega

Envie com `tipo` = `tasks` (ferramenta `agentboard_escrever_documento` ou marcadores, conforme `agentboard-planejamento`). Na execução, se a ferramenta `agentboard_marcar_task` existir, use-a para marcar itens em vez de reenviar o documento.
