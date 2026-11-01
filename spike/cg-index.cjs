// Indexa uma pasta com o CodeGraph pela API de biblioteca (não usa `init`/`install`, que mexem na config dos agentes).
const { CodeGraph } = require('@colbymchenry/codegraph')
const root = process.argv[2]
;(async () => {
  const t = Date.now()
  const cg = CodeGraph.isInitialized(root) ? await CodeGraph.open(root, {}) : await CodeGraph.init(root, {})
  const r = await cg.indexAll({})
  console.log(JSON.stringify({ ms: Date.now() - t, files: r.filesIndexed, nodes: r.nodesCreated, edges: r.edgesCreated }))
  cg.close()
})().catch((e) => { console.error(e); process.exit(1) })
