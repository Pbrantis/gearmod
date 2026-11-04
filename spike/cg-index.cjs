// Indexes a folder with CodeGraph through the library API (does not use `init`/`install`, which touch the agents' config).
const { CodeGraph } = require('@colbymchenry/codegraph')
const root = process.argv[2]
;(async () => {
  const t = Date.now()
  const cg = CodeGraph.isInitialized(root) ? await CodeGraph.open(root, {}) : await CodeGraph.init(root, {})
  const r = await cg.indexAll({})
  console.log(JSON.stringify({ ms: Date.now() - t, files: r.filesIndexed, nodes: r.nodesCreated, edges: r.edgesCreated }))
  cg.close()
})().catch((e) => { console.error(e); process.exit(1) })
