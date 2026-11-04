export interface Heading { level: 1 | 2 | 3 | 4 | 5 | 6; text: string; line: number }

/** Headings of a Markdown file (1-based line); `#` inside a block fenced by ``` or ~~~ does not count. */
export function markdownHeadings(source: string): Heading[] {
  const headings: Heading[] = []
  let fence: string | null = null
  for (const [index, row] of source.split(/\r?\n/).entries()) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(row)?.[1]
    if (marker) { if (!fence) fence = marker[0]!; else if (marker[0] === fence && marker.length >= fence.length && /^\s{0,3}[`~]+\s*$/.test(row)) fence = null; continue }
    if (fence) continue
    const found = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(row)
    if (found && found[2]) headings.push({ level: found[1]!.length as Heading['level'], text: found[2].replace(/[`*_]/g, ''), line: index + 1 })
  }
  return headings
}

/** Chain of headings that contain the line: the nearest one above it and the lower-level ones that lead up to the top. */
export function headingTrail(headings: Heading[], line: number): Heading[] {
  const above = headings.filter((heading) => heading.line <= line), trail: Heading[] = []
  for (const heading of [...above].reverse()) if (!trail.length || heading.level < trail[0]!.level) trail.unshift(heading)
  return trail
}
