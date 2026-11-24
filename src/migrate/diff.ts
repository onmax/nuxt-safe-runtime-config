import type { FileEdit } from './report'

type Operation = [' ' | '-' | '+', string]

function lines(text: string | null): string[] {
  if (text === null || text === '')
    return []
  const split = text.split('\n')
  if (split.at(-1) === '')
    split.pop()
  return split
}

function diffLines(a: string[], b: string[]): Operation[] {
  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++
  let suffix = 0
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++
  const left = a.slice(prefix, a.length - suffix)
  const right = b.slice(prefix, b.length - suffix)
  const middle: Operation[] = []
  if (left.length * right.length > 4_000_000) {
    middle.push(...left.map(text => ['-', text] as Operation), ...right.map(text => ['+', text] as Operation))
  }
  else {
    // Longest common subsequence table, filled from the end.
    const table = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1))
    for (let i = left.length - 1; i >= 0; i--) {
      for (let j = right.length - 1; j >= 0; j--)
        table[i]![j] = left[i] === right[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    }
    let i = 0
    let j = 0
    while (i < left.length || j < right.length) {
      if (i < left.length && j < right.length && left[i] === right[j]) {
        middle.push([' ', left[i]!])
        i++
        j++
      }
      else if (i < left.length && (j === right.length || table[i + 1]![j]! >= table[i]![j + 1]!)) {
        middle.push(['-', left[i]!])
        i++
      }
      else {
        middle.push(['+', right[j]!])
        j++
      }
    }
  }
  return [
    ...a.slice(0, prefix).map(text => [' ', text] as Operation),
    ...middle,
    ...a.slice(a.length - suffix).map(text => [' ', text] as Operation),
  ]
}

/** A unified diff of one file edit with three lines of context. */
export function unifiedDiff(edit: FileEdit, context = 3): string {
  const operations = diffLines(lines(edit.before), lines(edit.after))
  const header = [
    `--- ${edit.before === null ? '/dev/null' : `a/${edit.path}`}`,
    `+++ ${edit.after === null ? '/dev/null' : `b/${edit.path}`}`,
  ]
  const hunks: string[] = []
  let index = 0
  while (index < operations.length) {
    while (index < operations.length && operations[index]![0] === ' ') index++
    if (index >= operations.length)
      break
    const from = Math.max(0, index - context)
    let to = index
    // Extend the hunk while changes are within two context windows of each other.
    while (to < operations.length) {
      let next = to
      while (next < operations.length && operations[next]![0] !== ' ') next++
      let gap = next
      while (gap < operations.length && operations[gap]![0] === ' ') gap++
      to = next
      if (gap >= operations.length || gap - next > context * 2)
        break
      to = gap
    }
    const until = Math.min(operations.length, to + context)
    let oldStart = 1
    let newStart = 1
    for (let position = 0; position < from; position++) {
      if (operations[position]![0] !== '+')
        oldStart++
      if (operations[position]![0] !== '-')
        newStart++
    }
    const slice = operations.slice(from, until)
    const oldCount = slice.filter(([kind]) => kind !== '+').length
    const newCount = slice.filter(([kind]) => kind !== '-').length
    hunks.push(`@@ -${oldCount ? oldStart : oldStart - 1},${oldCount} +${newCount ? newStart : newStart - 1},${newCount} @@`)
    for (const [kind, text] of slice) hunks.push(`${kind}${text}`)
    index = until
  }
  return [...header, ...hunks].join('\n')
}
