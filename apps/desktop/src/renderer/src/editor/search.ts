import { SearchQuery, closeSearchPanel, openSearchPanel, search, setSearchQuery } from '@codemirror/search'
import type { EditorView } from '@codemirror/view'

/** O Localizar do app é o `FileFind`; o painel do CodeMirror existe escondido só para manter o destaque das ocorrências. */
export const hiddenSearch = search({ top: true, createPanel: () => { const dom = document.createElement('div'); dom.className = 'wf-hidden-search'; return { dom } } })
export interface FindQuery { search: string; caseSensitive: boolean; regexp: boolean; wholeWord: boolean; replace?: string }
/** Liga/desliga o destaque e define o texto procurado (o `openSearchPanel` troca a consulta pela seleção, por isso a ordem). */
export function applyFind(view: EditorView, open: boolean, query: FindQuery): void {
  if (!open || !query.search) { closeSearchPanel(view); view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '' })) }); return }
  openSearchPanel(view); view.dispatch({ effects: setSearchQuery.of(new SearchQuery(query)) })
}
