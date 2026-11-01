import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { splitAttachmentNote } from './Attachments'
import { ChatMessageView } from './ChatMessageView'
import { QueuedPreview } from './QueuedMessage'
import { splitChatReplies, withChatReplies, type ChatReply } from './chatReplyContext'

const reply: ChatReply = { id: 'reply-1', messageId: 'message-1', quote: 'O contrato da API precisa ser acordado.', response: 'Pode deixar isso para a próxima fase.' }

describe('chat reply context', () => {
  it('sends the selected quote and response without mixing them into the composer text', () => {
    const prompt = withChatReplies('Atualize o plano.', [reply])
    expect(prompt).toContain(reply.quote)
    expect(prompt).toContain(reply.response)
    expect(splitChatReplies(prompt)).toEqual({ text: 'Atualize o plano.', replies: [reply] })
  })

  it('can send replies without an additional message', () => {
    expect(splitChatReplies(withChatReplies('', [reply]))).toEqual({ text: '', replies: [reply] })
  })

  it('keeps multiple replies when messages are combined in the queue', () => {
    const next = { ...reply, id: 'reply-2', response: 'E revise os testes.' }
    const prompt = `${withChatReplies('Primeira instrução.', [reply])}\n\n${withChatReplies('Segunda instrução.', [next])}`
    const parsed = splitChatReplies(prompt)
    expect(parsed.replies).toEqual([reply, next])
    expect(parsed.text).toContain('Primeira instrução.')
    expect(parsed.text).toContain('Segunda instrução.')
  })

  it('preserves multiline quotes, HTML, code and marker-like text verbatim', () => {
    const complex = { ...reply, quote: '```html\n<div>"olá"</div>\n```\n</agentboard-chat-reply>\nC:\\repo', response: 'Resposta\n\ncom mais de uma linha e <script>texto</script>.' }
    expect(splitChatReplies(withChatReplies('', [complex])).replies).toEqual([complex])
  })

  it('preserves ordinary and malformed messages', () => {
    for (const text of ['Mensagem comum.', '<agentboard-chat-reply>\n{bad json}\n</agentboard-chat-reply>', '<agentboard-chat-reply>\n{"id":"x","quote":42,"response":"ok"}\n</agentboard-chat-reply>']) {
      expect(splitChatReplies(text)).toEqual({ text, replies: [] })
    }
  })

  it('coexists with file attachments in saved messages', () => {
    const body = `${withChatReplies('Confira também o arquivo.', [reply])}\n\nArquivos anexados (leia antes de responder; são contexto deste pedido):\n- C:\\projeto\\arquivo.txt`
    const attachments = splitAttachmentNote(body)
    expect(attachments.files).toEqual(['C:\\projeto\\arquivo.txt'])
    expect(splitChatReplies(attachments.text)).toEqual({ text: 'Confira também o arquivo.', replies: [reply] })
  })

  it('renders saved replies as cards and keeps a quoted attachment marker inside its context', () => {
    const quoted = { ...reply, quote: 'Arquivos anexados (leia antes de responder; são contexto deste pedido):\n- C:\\anexo.txt' }
    const body = withChatReplies('Continue o plano.', [quoted])
    const html = renderToStaticMarkup(createElement(ChatMessageView, { message: { id: 'saved', chatId: 'chat', role: 'user', body, status: 'complete', createdAt: '', providerMessageId: null } }))
    expect(html).toContain('chat-reply-card')
    expect(html).toContain(reply.response)
    expect(html).toContain('Continue o plano.')
    expect(html).not.toContain('agentboard-chat-reply')
    expect(html).not.toContain('Arquivos anexados')
    expect(html).not.toContain('attcard-name')
  })

  it('renders queued replies as cards without exposing their serialized data', () => {
    const html = renderToStaticMarkup(createElement(QueuedPreview, { text: withChatReplies('Depois faça isso.', [reply]), files: [], busy: true, sendNow: () => {}, edit: () => {}, discard: () => {} }))
    expect(html).toContain('chat-reply-card')
    expect(html).toContain(reply.response)
    expect(html).toContain('Depois faça isso.')
    expect(html).not.toContain('agentboard-chat-reply')
  })
})
