# Constituição do GearMod

**Versão:** 1.0.0 · **Ratificada em:** 2026-10-30

Princípios que valem para todo card. Detalhes de uma feature ficam na Especificação dela; comandos e convenções de trabalho ficam no `CLAUDE.md`.

Os componentes citados estão em `apps/desktop/src/renderer/src/`.

---

## I. Diálogos seguem um formato só

- **DEVE** usar `ConfirmDialog` para pedir confirmação e `NoticeDialog` para avisar algo com um botão só.
- **NÃO DEVE** usar `window.confirm`, `window.alert` ou `window.prompt`.
- Todo modal **DEVE** ter a estrutura `.overlay > .modal`, com `role="dialog"` (ou `role="alertdialog"` para confirmação e aviso) e `aria-label`.
- Todo modal **DEVE** ter `header` com `.eyebrow` (o contexto, ex.: "Excluir card") e `h2` (o título), e os botões no rodapé em `.actions`.
- Em `.actions` a ordem **DEVE** ser: Cancelar (`.secondary`) primeiro, ação principal por último. Ação destrutiva **DEVE** usar `.danger` (`.danger.solid` quando for o botão principal).
- Todo modal **DEVE** fechar com Esc (Esc cancela, nunca confirma). O handler de Esc **DEVE** parar a propagação, para não fechar o que estiver por trás.
- **Por quê:** o diálogo nativo do Electron não segue o tema, trava a janela e mostra o título do app; e cada modal feito à mão acabava com um comportamento de teclado diferente.

## II. Campos de formulário usam os componentes do app

- Lista de escolha **DEVE** usar `Select` (uma opção) ou `MultiSelect` (várias). **NÃO DEVE** usar `<select>` nativo.
- Caixa de seleção **DEVE** usar `Checkbox`. **NÃO DEVE** haver `<input type="checkbox">` solto, sem o visual do app.
- Liga/desliga **DEVE** usar o padrão de interruptor (`label.autosave > input[type=checkbox][role=switch] + span.sw`), por um componente compartilhado quando ele existir.
- Escolha exclusiva entre poucas opções descritas **DEVE** usar linhas `.ck-line.pickrow` (como em `GitSetup`).
- Campo de texto **DEVE** usar a classe `in`, e o rótulo **DEVE** envolver o campo (`label.f`) ou ligar-se a ele por `aria-label`.
- **Por quê:** os controles nativos ignoram o tema (escuro e claro) e cada um aparece de um jeito no Windows; com um componente só, ajustar o visual é um lugar só.

## III. Dica de botão é `data-tip`

- Dica ao passar o mouse **DEVE** usar o atributo `data-tip`, que o `TooltipLayer` mostra.
- **NÃO DEVE** usar o atributo `title` nativo em elementos HTML. (A prop `title` de componentes como `ConfirmDialog` não é dica e não entra nesta regra.)
- Botão só com ícone **DEVE** ter `data-tip` e `aria-label` dizendo o que ele faz.
- **Por quê:** o `title` nativo demora, não segue o tema e sai em lugar diferente do tooltip do app; misturar os dois deixa a interface inconsistente.

## IV. Cores vêm do tema

- Cores **DEVEM** vir das variáveis do `prototype.css` (`--text`, `--muted`, `--surface*`, `--border`, `--accent*`, `--danger`…) ou das classes que já as usam.
- **NÃO DEVE** haver cor fixa (`#hex`, `rgb()`) em `style` inline nos `.tsx`. Exceção: dados que são a própria cor (paleta de agentes, amostras de tema, cor escolhida pelo usuário).
- Regra nova de CSS com cor fixa **DEVE** ter a variante do tema claro (`:root[data-theme="light"]`).
- **Por quê:** o app tem tema claro e vários acentos; uma cor fixa some ou fica ilegível quando o tema muda.

## V. Erro aparece para o usuário em português simples

- Falha de uma ação que o usuário pediu **DEVE** aparecer para ele: `toast.error` ou mensagem no próprio diálogo, com o texto passado por `plainError`.
- **NÃO DEVE** engolir o erro de uma ação do usuário com `catch(() => undefined)`. Engolir só é aceito em leituras de fundo opcionais (ex.: carregar um selo, uma contagem).
- **NÃO DEVE** mostrar `String(error)` cru (com "Error invoking remote method…").
- **Por quê:** clicar e nada acontecer é o pior caso; e a mensagem técnica do Electron não diz nada ao usuário.

## VI. Toda a interface é em português do Brasil

- Texto visível, dicas, `aria-label`, mensagens de erro e de confirmação **DEVEM** estar em pt-BR, sem jargão desnecessário. Termos consagrados do Git e das ferramentas (commit, branch, worktree, pull request) podem ficar em inglês.
- Botão de confirmação **DEVE** dizer a ação ("Excluir", "Descartar", "Enviar"), não "OK" ou "Sim".
- **Por quê:** o público do app fala português; e um botão com o verbo deixa claro o que vai acontecer antes do clique.

## VII. Renderer só fala com o main pelo contrato

- O renderer **DEVE** chamar o main só por `window.gearmod.invoke`, com o canal tipado em `@gearmod/contracts`. **NÃO DEVE** usar `ipcRenderer`, `require('electron')` ou Node direto.
- Canal novo **DEVE** ter o tipo de entrada e saída no contrato e teste no main.
- **Por quê:** o contrato é o que mantém os dois lados conferidos pelo TypeScript e o renderer isolado do sistema.

## VIII. Nada se perde sem querer

- Excluir arquivo ou pasta do usuário **DEVE** mandar para a Lixeira (`shell.trashItem`). **NÃO DEVE** apagar em definitivo o que é do usuário. (Pastas temporárias do próprio app podem ser apagadas.)
- Ação destrutiva ou que descarta edição **DEVE** pedir confirmação com `ConfirmDialog` (`danger`) dizendo o que se perde.
- Migração de banco **DEVE** ser nova e numerada; **NÃO DEVE** alterar uma migração já publicada.
- **Por quê:** o usuário confia projetos e histórico ao app; um erro aqui não tem volta.

---

## Registro de mudanças

- **1.0.0 (2026-10-30):** primeira versão, levantada dos padrões que o código já usa (diálogos, campos, tooltip, tema, erros, idioma, contrato IPC, exclusão).
