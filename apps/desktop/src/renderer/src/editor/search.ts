import { SearchQuery, closeSearchPanel, openSearchPanel, search, setSearchQuery } from '@codemirror/search'
import type { EditorView } from '@codemirror/view'

/** The app's Find is `FileFind`; the CodeMirror panel exists hidden only to keep the match highlighting. */
export const hiddenSearch = search({ top: true, createPanel: () => { const dom = document.createElement('div'); dom.className = 'wf-hidden-search'; return { dom } } })
export interface FindQuery { search: string; caseSensitive: boolean; regexp: boolean; wholeWord: boolean; replace?: string }
/** Turns the highlight on/off and sets the searched text (`openSearchPanel` swaps the query for the selection, hence the order). */
export function applyFind(view: EditorView, open: boolean, query: FindQuery): void {
  if (!open || !query.search) { closeSearchPanel(view); view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '' })) }); return }
  openSearchPanel(view); view.dispatch({ effects: setSearchQuery.of(new SearchQuery(query)) })
}
