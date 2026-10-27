import { describe, expect, it } from 'vitest'
import { parseTasks } from './ProgressCard'

describe('painel de progresso', () => {
  it('lê tasks com critérios e fases, com quebra de linha do Windows', () => {
    const tasks = parseTasks('## Tasks\r\n\r\n### Fase 1: Base\r\n- [x] T001 Criar `tabela`\r\n  - [x] migração\r\n  - [ ] teste\r\n\r\n**Ponto de verificação:** ok\r\n\r\n### Fase 2\r\n- [ ] T002 Tela\r\n- [X] T003 Fim')
    expect(tasks.map((task) => [task.text, task.done, task.group, task.criteria.length])).toEqual([
      ['T001 Criar `tabela`', true, 'Fase 1: Base', 2],
      ['T002 Tela', false, 'Fase 2', 0],
      ['T003 Fim', true, 'Fase 2', 0]
    ])
    expect(tasks[0]!.criteria).toEqual([{ text: 'migração', done: true, line: 4 }, { text: 'teste', done: false, line: 5 }])
    // A linha de cada item é o que o clique do usuário usa para marcá-lo no checklist.
    expect(tasks.map((task) => task.line)).toEqual([3, 10, 11])
  })
})
