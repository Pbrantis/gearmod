// Programming terms in Portuguese -> words that usually appear in code names (in English).
// It only expands the text search; symbol names cited in the question still count as they are.
const PT_EN: Record<string, string> = {
  caminho: 'path', caminhos: 'path', arquivo: 'file', arquivos: 'file', pasta: 'folder dir directory', pastas: 'folder dir',
  ler: 'read', le: 'read', lê: 'read', leitura: 'read', escrever: 'write', escreve: 'write', grava: 'write save', gravar: 'write save', salvar: 'save', salva: 'save',
  permitido: 'allowed allow', permitida: 'allowed allow', permitidas: 'allowed', permissao: 'permission', permissão: 'permission', permissoes: 'permission',
  validar: 'validate valid check', valida: 'validate valid check', validacao: 'validate validation', validação: 'validate validation', verificar: 'check verify', verifica: 'check verify',
  criar: 'create new', cria: 'create', apagar: 'delete remove trash', apaga: 'delete remove', remover: 'remove delete', excluir: 'delete remove', lixeira: 'trash',
  renomear: 'rename', mover: 'move', copiar: 'copy', abrir: 'open', abre: 'open', fechar: 'close', fecha: 'close',
  buscar: 'search find', busca: 'search find', procurar: 'search find', pesquisa: 'search', encontrar: 'find', lista: 'list', listar: 'list',
  projeto: 'project', projetos: 'project', tarefa: 'task', tarefas: 'task', cartao: 'card', cartão: 'card', quadro: 'board', coluna: 'column', colunas: 'column',
  usuario: 'user', usuário: 'user', perfil: 'profile', perfis: 'profile', conta: 'account', senha: 'password secret', sessao: 'session', sessão: 'session',
  configuracao: 'config settings', configuração: 'config settings', configuracoes: 'settings config', preferencias: 'settings preferences', ajustes: 'settings',
  erro: 'error', erros: 'error', aviso: 'warning toast notify', notificacao: 'notify notification toast', notificação: 'notify notification toast',
  janela: 'window', tela: 'page screen view', pagina: 'page', página: 'page', botao: 'button', botão: 'button', menu: 'menu', dialogo: 'dialog', diálogo: 'dialog', painel: 'panel pane',
  chamar: 'call invoke', chama: 'call invoke', enviar: 'send', envia: 'send', receber: 'receive', recebe: 'receive', responder: 'reply answer respond', resposta: 'reply response answer', pergunta: 'question ask',
  atualizar: 'update refresh', atualiza: 'update refresh', desatualizado: 'stale outdated', desatualizada: 'stale outdated', versao: 'version', versão: 'version', mudanca: 'change', mudança: 'change', mudancas: 'changes',
  conversa: 'chat conversation', conversas: 'chat conversation', mensagem: 'message', mensagens: 'message', agente: 'agent', agentes: 'agent',
  executar: 'run execute exec', executa: 'run execute', rodar: 'run', roda: 'run', execucao: 'run execution', execução: 'run execution', processo: 'process', fila: 'queue',
  teste: 'test', testes: 'test', banco: 'database db', consulta: 'query', tabela: 'table', migracao: 'migration', migração: 'migration',
  grafo: 'graph', raiz: 'root', ramo: 'branch', branch: 'branch', commit: 'commit', confirmar: 'commit confirm', mesclar: 'merge', diferenca: 'diff', diferença: 'diff', conflito: 'conflict', conflitos: 'conflict',
  servidor: 'server', cliente: 'client', requisicao: 'request', requisição: 'request', canal: 'channel ipc',
  idioma: 'language locale', traducao: 'translate i18n', tradução: 'translate i18n', tema: 'theme', cor: 'color', icone: 'icon', ícone: 'icon', imagem: 'image', texto: 'text',
  evento: 'event', eventos: 'event', historico: 'history', histórico: 'history', registro: 'record log', registrar: 'record register', exploracao: 'exploration explore', exploração: 'exploration explore', explorar: 'explore',
  plano: 'plan', planejamento: 'planning plan', especificacao: 'spec specification', especificação: 'spec specification', documento: 'document doc', documentos: 'document doc', resumo: 'summary',
  anexo: 'attachment', anexos: 'attachment', colar: 'paste', arrastar: 'drag drop', soltar: 'drop', voz: 'voice', audio: 'audio', áudio: 'audio', gravacao: 'recording record',
  constituicao: 'constitution', constituição: 'constitution', complexidade: 'complexity', fluxo: 'flow workflow', decisao: 'decision', decisão: 'decision',
  editor: 'editor', aba: 'tab', abas: 'tab', arvore: 'tree', árvore: 'tree', explorador: 'explorer', terminal: 'terminal', comando: 'command', atalho: 'shortcut keybinding hotkey',
  inicio: 'start init', início: 'start init', iniciar: 'start init', parar: 'stop', cancelar: 'cancel', retomar: 'resume', pausar: 'pause', esperar: 'wait',
  limite: 'limit', custo: 'cost usage', uso: 'usage', modelo: 'model', esforco: 'effort', esforço: 'effort', trabalho: 'work worktree', copia: 'copy'
}

export function expandTerms(words: string[]): string[] {
  const out = new Set(words)
  for (const w of words) { const e = PT_EN[w.toLowerCase()]; if (e) for (const x of e.split(' ')) out.add(x) }
  return [...out]
}
