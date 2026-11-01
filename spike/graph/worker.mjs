// Worker de parse: recebe lotes de arquivos e devolve a extração de cada um.
import { parentPort } from 'node:worker_threads'
import { readFileSync } from 'node:fs'
import { extract } from './extract.mjs'

parentPort.on('message', async ({ id, jobs }) => {
  const out = []
  for (const j of jobs) {
    try {
      const src = j.src ?? readFileSync(j.file, 'utf8')
      out.push({ sha: j.sha, lang: j.lang, x: await extract(j.lang, src) })
    } catch (e) {
      out.push({ sha: j.sha, lang: j.lang, error: String(e?.message ?? e) })
    }
  }
  parentPort.postMessage({ id, out })
})
