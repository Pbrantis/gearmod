---
name: agentboard-constituicao
description: Conduz o chat da Constituição de um projeto do AgentBoard (no estilo do constitution do GitHub Spec Kit) — princípios numerados com regras e motivo, versão semântica e registro de mudanças. Use quando o AgentBoard abrir o chat da Constituição.
---

# Constituição do projeto (AgentBoard)

A Constituição reúne os princípios que valem para **todo** card do projeto: o que não pode ser quebrado, seja qual for a tarefa. A Especificação de um card diz o que aquele card entrega; o `CLAUDE.md`/`AGENTS.md` diz como trabalhar no repositório (comandos, convenções). A Constituição fica acima dos dois e não repete o que é deles.

Este chat só escreve a Constituição: leia o código à vontade, sem alterar arquivos nem cards.

## Fluxo

1. **Entender.** Leia a Constituição atual e as mudanças sugeridas que vêm no contexto. Se ela estiver vazia, leia o projeto (só leitura): stack, estrutura, testes, `CLAUDE.md`/`AGENTS.md`, `docs/`. Procure o que já é regra de fato (padrões repetidos, decisões de arquitetura, restrições de segurança e dados).
2. **Conversar.** Proponha os princípios ao usuário antes de gravar. Pergunte o que só ele sabe (prioridades, o que é inegociável). Prefira poucos princípios fortes a muitos fracos: entre 3 e 9 costuma bastar.
3. **Gravar.** Com o acordo do usuário, grave o texto **completo** com `agentboard_escrever_constituicao`. Nunca grave só um trecho.
4. **Mudanças sugeridas.** Para cada mudança sugerida pelos agentes (C001, C002…), diga se faz sentido e o que ficaria no texto; aplique só as que o usuário aprovar.

## Regras de escrita

- Cada princípio tem título, as regras em **DEVE** / **NÃO DEVE** (verificáveis, sem "deveria tentar") e uma linha de **Por quê**.
- Nada de detalhe de implementação de um card só. Se uma regra só vale para uma feature, ela é da Especificação dessa feature.
- **Versão** no cabeçalho, no formato MAIOR.MENOR.CORREÇÃO:
  - MAIOR: princípio removido ou regra que muda de sentido;
  - MENOR: princípio novo ou regra ampliada;
  - CORREÇÃO: só redação, sem mudar obrigação.
- **Registro de mudanças** no fim: uma linha por versão com o que mudou e por quê.
- Escreva no idioma do contexto. Use o modelo abaixo.
