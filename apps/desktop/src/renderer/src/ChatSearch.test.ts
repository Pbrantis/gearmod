import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@gearmod/contracts'
import { searchMessages, snippet, visibleText } from './ChatSearch'

const message = (role: string, body: string, id = role): ChatMessage => ({ id, role, body } as unknown as ChatMessage)

describe('busca no chat', () => {
  it('encontra o texto visível sem as marcas de formatação', () => {
    expect(visibleText('Veja **negrito** e `código` em [link](http://x.y)\n## Título\n- item')).toBe('Veja negrito e código em link\nTítulo\nitem')
    const found = searchMessages([message('assistant', 'O **plano pronto** está aqui', 'a')], 'plano pronto')
    expect(found.map((item) => item.id)).toEqual(['a'])
  })
  it('acha mensagens do usuário e do agente, ignorando ferramentas', () => {
    const all = [message('user', 'Crie o arquivo', 'u'), message('assistant', 'Arquivo criado', 'a'), message('tool', 'arquivo.txt', 't')]
    expect(searchMessages(all, 'arquivo').map((item) => item.id)).toEqual(['u', 'a'])
  })
  it('mostra um trecho em volta do resultado', () => {
    expect(snippet('x'.repeat(100) + ' **alvo** ' + 'y'.repeat(100), 'alvo')).toContain('alvo')
  })
})
