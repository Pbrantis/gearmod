---
name: agentboard-plano
description: Escreve o documento Plano de um card do AgentBoard no estilo SDD (resumo técnico, contexto técnico, verificação dos princípios do projeto, decisões com alternativas, modelo de dados, contratos, áreas afetadas, riscos e validação), com base no código real do projeto.
---

# Documento: Plano

O Plano diz **como** a Especificação vai ser implementada. É escrito depois de ler o código (só leitura) e é o que o agente de execução segue. A estrutura segue o modelo de plano do GitHub Spec Kit, enxuta para um card.

## Idioma

Escreva no idioma informado em `idioma`. Use `templates/<idioma>.md`; se não houver, traduza `templates/pt-BR.md`, incluindo títulos das seções.

## Seções (nesta ordem)

1. **Resumo.** O requisito principal e a abordagem técnica em 2 ou 3 frases.
2. **Contexto técnico.** Só o que importa para este card, tirado do repositório: linguagem e versão, dependências principais, armazenamento, testes, plataforma, restrições. O que não souber, marque `[PRECISA ESCLARECER]` e resolva no chat.
3. **Verificação de princípios.** Leia os princípios do projeto: primeiro a Constituição (texto completo com `agentboard_ler_constituicao`, se o contexto trouxer só o índice), depois `AGENTS.md`, `CLAUDE.md` e decisões em `docs/`. Liste os que se aplicam e diga se o plano respeita cada um (✅) ou não (⚠️). Um ⚠️ exige a seção Complexidade.
4. **Decisões.** Cada uma no formato **Decisão** / **Motivo** / **Alternativas descartadas**.
5. **Modelo de dados.** Só se o card muda dados: tabelas, campos, migração e o que acontece com dados existentes.
6. **Contratos.** Só se o card muda uma interface (IPC, API, eventos, formato de arquivo): nome, entrada, saída e validação.
7. **Áreas afetadas.** Caminhos reais do repositório (verifique que existem) e o que muda em cada um. Arquivo novo leva "(novo)". Não invente caminhos.
8. **Riscos.** O que pode quebrar e como evitar. Remova se não houver risco real.
9. **Como validar.** Comandos que o projeto já usa (testes, typecheck, lint) e o passo manual que prova cada história P1.
10. **Complexidade.** Só se houver ⚠️ na verificação de princípios: tabela Violação / Por que é necessária / Alternativa mais simples descartada porque.

## Regras

- Não repita a Especificação; cite os IDs (`RF-001`, `História 1`) quando ajudar.
- Não liste tasks aqui; elas ficam no documento Tasks.
- Mantenha o plano do tamanho do card. Remova seções opcionais vazias.

## Entrega

Envie com `tipo` = `plano` (ferramenta `agentboard_escrever_documento` ou marcadores, conforme `agentboard-planejamento`).

## Plano de testes

Inclua no Plano uma seção `## Plano de testes`. É o roteiro do testador e o lugar de tudo que é verificação (nada disso vira task):

- **Por história:** o que testar, como (comando ou passos na tela) e o resultado esperado.
- **Testes automatizados esperados:** quais testes o desenvolvedor escreve junto com as tasks (arquivo e o que cobrem), para o testador conferir se existem e se fazem sentido.
- **Regressões:** o que já existe e não pode quebrar (ex.: "o botão de primeiro acesso continua funcionando").
- **Comandos do projeto:** lint, type-check e suíte de testes que o testador roda inteiros.

O testador e o desenvolvedor usam essa seção; o que faltar nela vira dúvida ou proposta de mudança.
