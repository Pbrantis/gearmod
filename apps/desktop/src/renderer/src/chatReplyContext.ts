export interface ChatReply { id: string; messageId?: string; quote: string; response: string }

/** Inline context travels with the prompt, including queued messages and saved history. */
export function withChatReplies(text: string, replies: ChatReply[]): string {
  return [text.trim(), ...replies.map((reply) => `<agentboard-chat-reply>\n${JSON.stringify(reply)}\n</agentboard-chat-reply>`)].filter(Boolean).join('\n\n')
}

export function splitChatReplies(body: string): { text: string; replies: ChatReply[] } {
  const replies: ChatReply[] = []
  const text = body.replace(/(^|\n)<agentboard-chat-reply>\n([^\n]+)\n<\/agentboard-chat-reply>(?=\n|$)/g, (block: string, leading: string, json: string) => {
    try {
      const value: unknown = JSON.parse(json)
      if (!value || typeof value !== 'object') return block
      const reply = value as Record<string, unknown>
      if (typeof reply.id !== 'string' || typeof reply.quote !== 'string' || !reply.quote.trim() || typeof reply.response !== 'string' || !reply.response.trim() || (reply.messageId !== undefined && typeof reply.messageId !== 'string')) return block
      replies.push({ id: reply.id, quote: reply.quote, response: reply.response, ...(typeof reply.messageId === 'string' ? { messageId: reply.messageId } : {}) })
      return leading
    } catch { return block }
  })
  return { text: text.trim(), replies }
}
