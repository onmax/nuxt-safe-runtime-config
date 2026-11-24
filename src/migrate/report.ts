export interface FileEdit {
  /** Path relative to the project directory. */
  path: string
  /** `null` when the codemod creates the file. */
  before: string | null
  /** `null` when the codemod deletes the file. */
  after: string | null
}

export interface Note {
  file?: string
  line?: number
  text: string
}

export interface Report {
  /** Reasons to stop without writing anything. */
  stops: Note[]
  /** Schema rules that Nuxt does not check. */
  refinements: Note[]
  /** Options and schema features whose behaviour changes. */
  changes: Note[]
  /** Leftovers to check by hand. */
  manual: Note[]
}

export function createReport(): Report {
  return { stops: [], refinements: [], changes: [], manual: [] }
}

export function formatNote(note: Note): string {
  const where = note.file ? `${note.file}${note.line ? `:${note.line}` : ''} ` : ''
  return `${where}${note.text}`
}
