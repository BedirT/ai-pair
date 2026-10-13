// Turning a `say` into words worth speaking: no markdown, no links read out letter by letter,
// and split into sentences, so the first sound comes fast and stale lines can be dropped whole.

/** A `say` cleaned for the ear: code kept as words, link targets and markup dropped. */
export function spokenText(text: string): string {
  return text
    .replace(/```[a-z]*\n?[\s\S]*?```/g, " ") // a code block is for the eyes
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "a link")
    .replace(/[#*_~>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

const MAX_CHUNK = 200

/** Sentences of a text, long ones cut at a comma or a space, so no chunk runs past a breath. */
export function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?…]+[.!?…]+["')\]]*\s*|[^.!?…]+$/g) ?? []
  const out: string[] = []
  for (const part of parts) {
    let rest = part.trim()
    while (rest.length > MAX_CHUNK) {
      const cut = Math.max(rest.lastIndexOf(", ", MAX_CHUNK), rest.lastIndexOf(" ", MAX_CHUNK))
      const at = cut > 40 ? cut + 1 : MAX_CHUNK
      out.push(rest.slice(0, at).trim())
      rest = rest.slice(at).trim()
    }
    if (rest) out.push(rest)
  }
  return out.filter(Boolean)
}
