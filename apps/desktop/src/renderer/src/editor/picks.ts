import { RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, GutterMarker, gutterLineClass, lineNumbers } from '@codemirror/view'

/** Lines picked for commenting (0-based indexes, in any order); `null` clears. */
export const setPicked = StateEffect.define<[number, number] | null>()
class PickedMarker extends GutterMarker { elementClass = 'wf-picked-gutter' }
const marker = new PickedMarker(), lineClass = Decoration.line({ class: 'wf-picked' })
const range = (state: EditorView['state'], picked: [number, number]): [number, number] => { const last = state.doc.lines; return [Math.min(Math.min(...picked) + 1, last), Math.min(Math.max(...picked) + 1, last)] }
const pickedField = StateField.define<[number, number] | null>({
  create: () => null,
  update: (value, transaction) => { for (const effect of transaction.effects) if (effect.is(setPicked)) value = effect.value; return value },
  provide: (field) => [
    EditorView.decorations.compute([field, 'doc'], (state) => { const picked = state.field(field), builder = new RangeSetBuilder<Decoration>(); if (picked) { const [from, to] = range(state, picked); for (let number = from; number <= to; number++) builder.add(state.doc.line(number).from, state.doc.line(number).from, lineClass) } return builder.finish() }),
    gutterLineClass.compute([field, 'doc'], (state) => { const picked = state.field(field), builder = new RangeSetBuilder<GutterMarker>(); if (picked) { const [from, to] = range(state, picked); for (let number = from; number <= to; number++) builder.add(state.doc.line(number).from, state.doc.line(number).from, marker) } return builder.finish() })
  ]
})

/** Number gutter where clicking picks the line, Shift+click extends and dragging picks several (`pick(index, extend)`, `drag(index)`). */
export function linePicker(pick: (index: number, extend: boolean) => void, drag: (index: number) => void, end: () => void): Extension {
  const indexOf = (view: EditorView, from: number): number => view.state.doc.lineAt(from).number - 1
  return [pickedField, lineNumbers({ domEventHandlers: {
    mousedown: (view, line, event) => { if ((event as MouseEvent).button !== 0) return false; pick(indexOf(view, line.from), (event as MouseEvent).shiftKey); document.addEventListener('mouseup', end, { once: true }); return true },
    mouseover: (view, line) => { drag(indexOf(view, line.from)); return false }
  } })]
}
