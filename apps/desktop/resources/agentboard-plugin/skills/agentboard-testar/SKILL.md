---
name: agentboard-testar
description: Testa um card do AgentBoard conferindo as Tasks e os critérios de aceite contra o que foi implementado, na worktree do card. Use quando o AgentBoard pedir para testar o card.
---

# Testar card (AgentBoard)

Teste este card na worktree atual: confira as Tasks e os critérios de aceite do contexto contra o que foi implementado.

- Antes de começar, monte o checklist do que vai verificar e grave com `agentboard_checklist_teste` (itens `- [ ] ...`, um por verificação: testes, lint, typecheck, cada critério de aceite que vai conferir, revisão do diff). Ao terminar cada item, grave o checklist de novo com ele marcado (`- [x]`); se falhou, deixe `- [ ]` e acrescente ` — falhou: <motivo>`. O usuário acompanha esse checklist ao lado do chat.
- Rode os testes, o lint e o typecheck do projeto, revise o diff e aponte o que falhar, com o motivo e onde.
- Use o plano de testes do Plano e os critérios das Tasks como roteiro: rode a suíte inteira, confira cada regressão listada e valide cada critério.
- Julgue os testes automatizados que o desenvolvedor escreveu: existem os que o Plano de testes pede? Cobrem o critério de verdade (não são vazios nem só "não quebra")? Teste faltando ou fraco vira item reprovado no checklist com o motivo; você não escreve o código dele. O que não estiver nos documentos e for preciso testar vira proposta com `agentboard_propor_mudanca`.
- Marque com `agentboard_marcar_task` só o que você verificou de fato. Ao terminar, atualize o Resumo com `agentboard_escrever_documento` dizendo se está pronto ou o que falta.
- Se tiver uma dúvida que os documentos não respondem, use `agentboard_perguntar_ao_planejador`, continue só com o que não depende dela e termine a execução: o app te retoma com a resposta.
- Não altere o código a menos que o usuário peça, e não mova o card de coluna.

## Testes de tela com o Playwright

Duas ferramentas, para coisas diferentes (podem ser combinadas):

- **Playwright CLI (`playwright-cli`)**: para explorar e conferir a tela gastando pouco contexto. Só use se o contexto trouxer `playwrightCli` (o usuário ligou e instalou no projeto); use o caminho de `comando`.
  - Sempre na sessão do card: `<comando> -s=<sessao> open <url>`, depois `snapshot`, `click <ref>`, `fill <ref> <texto>`. Headless é o padrão; `--headed` só se o usuário pedir para acompanhar.
  - Prefira `snapshot` e refs a screenshots. Screenshot só para provar um critério ou uma falha: `<comando> -s=<sessao> screenshot --filename=<evidencias>/<critério>.png`, e cite o caminho no checklist.
  - Não cole snapshots inteiros repetidos nem logs enormes na resposta: resuma o que viu e aponte o arquivo.
  - Ao terminar: `<comando> -s=<sessao> close`.
  - O CLI não substitui uma suíte versionada: se o critério precisa continuar coberto, diga que vale um teste do Playwright Test.
- **Playwright Test**: testes automatizados e reproduzíveis, como abaixo.

Use o Playwright para conferir os critérios de aceite que só se verificam na tela (aparece só para certo perfil, diálogo fecha ao cancelar, fluxo completo). Os testes unitários, o lint e o typecheck continuam sendo rodados normalmente.

- **Já tem Playwright no projeto** (`playwright.config.*` ou `@playwright/test` no `package.json`): rode `npx playwright test --reporter=line` na worktree e ponha o resultado como um item do checklist. Para um critério específico, rode só o arquivo ou o título com `-g`.
- **Sem janela por padrão (headless).** Deixe `video`/`trace`/`screenshot` ligados só para falhas (`--trace=retain-on-failure`) e grave no checklist o caminho do trace ou do screenshot de cada falha (`npx playwright show-trace <arquivo>` abre o trace).
- **Se o usuário pedir para acompanhar** ("ver o navegador", "mostrar na tela"): rode com `--headed` e, se der, `slowMo: 400` em `launchOptions`, para dar tempo de acompanhar. O modo `--ui` só se o usuário pedir, porque ele abre uma janela interativa que espera por ele.
- **Precisa do servidor da aplicação no ar?** Suba o comando de desenvolvimento do projeto em segundo plano, espere a porta responder e encerre o processo ao terminar. Não deixe servidor rodando.
- **Faltam os navegadores ou o Playwright nem existe no projeto?** Não instale nada sozinho: baixar navegadores são ~150 MB. Diga isso ao usuário (ou abra uma proposta com `agentboard_propor_mudanca`) e siga com o que dá para testar sem isso.
- Teste a tela do jeito que o usuário usa (clicar, digitar, esperar o resultado visível), não a implementação por dentro. Marque a task só quando o critério foi observado de fato.

- **Reavaliação:** se a validação for bem mais difícil do que a avaliação do card previa, ou os mesmos testes falharem de novo após correção, reavalie com `agentboard_avaliar_complexidade` (gatilho `failures` ou `risk`).
