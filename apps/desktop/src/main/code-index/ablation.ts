/**
 * Research switches for the benchmark (bench/): GEARMOD_INDEX_ABLATE=types,terms,lines,mentions turns one part of the
 * index off to measure what it contributes. The app never sets the variable, so all parts stay on.
 * - types: no type-based linking; a call on a receiver links by method name only (like the simpler indexes).
 * - terms: no Portuguese → English expansion in text search.
 * - lines: impact lists the callers without the line of each call.
 * - mentions: impact leaves out mentions of the name outside the graph (strings, mocks, comments).
 */
export type AblationPart = 'types' | 'terms' | 'lines' | 'mentions'

const off = new Set((process.env.GEARMOD_INDEX_ABLATE ?? '').split(',').map((part) => part.trim()).filter(Boolean))

export const ablated = (part: AblationPart): boolean => off.has(part)

/** Folds the switches into the linker version, so a database built with another setting is relinked. */
export const ablationTag = (): string => [...off].sort().join('+')
