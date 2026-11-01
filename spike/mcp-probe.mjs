// Liga um servidor MCP por stdio, pede tools/list e mede o tamanho das definições (custo fixo no contexto do agente).
import { spawn } from 'node:child_process'

const [cmd, ...args] = process.argv.slice(2)
const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'ignore'], env: process.env })
let buf = ''
const NL = String.fromCharCode(10)
p.stdout.on('data', (d) => {
  buf += d
  const lines = buf.split(NL)
  buf = lines.pop()
  for (const line of lines) {
    try {
      const m = JSON.parse(line)
      if (m.id === 2) {
        const tools = m.result.tools
        console.log('ferramentas', tools.length, '-', tools.map((t) => t.name).join(', '))
        console.log('definições ≈ tokens', Math.round(JSON.stringify(tools).length / 4))
        // PROBE_CALL='nome {json}' faz uma chamada de teste
        if (process.env.PROBE_CALL) { const i = process.env.PROBE_CALL.indexOf(' '); send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: process.env.PROBE_CALL.slice(0, i), arguments: JSON.parse(process.env.PROBE_CALL.slice(i + 1)) } }); continue }
        p.kill()
        process.exit(0)
      }
      if (m.id === 3) {
        const text = m.result?.content?.[0]?.text ?? JSON.stringify(m)
        console.log(m.result?.isError ? 'ERRO' : 'ok', `${text.length} caracteres`)
        console.log(text.slice(0, 600))
        p.kill()
        process.exit(0)
      }
    } catch { /* linha não-JSON */ }
  }
})
const send = (m) => p.stdin.write(JSON.stringify(m) + NL)
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'probe', version: '1' } } })
setTimeout(() => { send({ jsonrpc: '2.0', method: 'notifications/initialized' }); send({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) }, 1500)
setTimeout(() => { console.log('sem resposta'); p.kill(); process.exit(1) }, 30000)
