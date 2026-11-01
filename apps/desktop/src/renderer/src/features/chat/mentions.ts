/** "@Bruno Costa" picked from the list becomes the wire mention <@id> on send (longest names first). */
export function encodeMentions(text: string, picked: Map<string, string>): string {
  let out = text
  for (const [name, id] of [...picked].sort((a, b) => b[0].length - a[0].length)) out = out.split(`@${name}`).join(`<@${id}>`)
  return out
}
