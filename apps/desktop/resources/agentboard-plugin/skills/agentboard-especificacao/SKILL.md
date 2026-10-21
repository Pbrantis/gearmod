---
name: agentboard-especificacao
description: Escreve o documento Especificação de um card do AgentBoard no estilo SDD (histórias de usuário com prioridade, cenários de aceite Dado/Quando/Então, requisitos funcionais numerados e critérios de sucesso mensuráveis), sem dizer como implementar.
---

# Documento: Especificação

A Especificação diz **o que** o card entrega e **como saber que está certo**. O **como implementar** fica no Plano. A estrutura segue o modelo de especificação do GitHub Spec Kit, enxuta para um card.

## Idioma

Escreva no idioma informado em `idioma`. Use `templates/<idioma>.md`; se não houver, traduza `templates/pt-BR.md`, incluindo títulos, rótulos (Dado/Quando/Então) e prefixos de ID (RF, CS).

## Seções (nesta ordem)

1. **Objetivo.** Uma frase, do ponto de vista de quem usa.
2. **Histórias de usuário** (obrigatória). Cada história:
   - título `História N: <nome curto> (Prioridade: P1|P2|P3)`; P1 é o mínimo que já entrega valor sozinho (MVP);
   - uma frase "Como <papel>, quero <ação>, para <benefício>";
   - **Por que esta prioridade:** uma frase;
   - **Teste independente:** como verificar esta história sozinha;
   - **Cenários de aceite:** lista numerada no formato **Dado** <estado>, **Quando** <ação>, **Então** <resultado observável>.
3. **Casos de borda.** Perguntas sobre limites e erros ("O que acontece quando ...?"). Remova se não houver.
4. **Requisitos funcionais** (obrigatória). IDs `RF-001`, `RF-002`... Um requisito por linha, verificável:
   - "O sistema DEVE <capacidade>." ou "O usuário DEVE conseguir <interação>."
   - para gatilhos, use a forma "QUANDO <evento>, o sistema DEVE <resposta>."
   - dúvida que muda o resultado vira `[PRECISA ESCLARECER: <pergunta>]` no próprio requisito. No máximo 3 marcas; o planejamento pergunta ao usuário e remove as marcas.
5. **Entidades-chave.** Só se o card mexe com dados: nome, o que representa e relações, sem tipos nem tabelas.
6. **Critérios de sucesso** (obrigatória). IDs `CS-001`... Mensuráveis e independentes de tecnologia ("o usuário cria o card em até 3 cliques", "nenhum card muda de coluna sem pedido").
7. **Premissas e fora de escopo.** O que se assumiu e o que este card não faz.

## Cards do tipo bug

Troque as histórias por: **Como reproduzir** (passos numerados), **Comportamento atual** e **Comportamento esperado**. Mantenha Requisitos funcionais (o que a correção garante) e Critérios de sucesso (incluindo "o bug não volta": um teste que falhava passa).

## Regras

- Nada de arquivos, funções, bibliotecas ou tabelas: isso é do Plano.
- Escreva para quem decide o produto entender sem ler código.
- Não deixe seção vazia nem "N/A": remova a seção opcional.

## Entrega

Envie com `tipo` = `especificacao` (ferramenta `agentboard_escrever_documento` ou marcadores, conforme `agentboard-planejamento`).
