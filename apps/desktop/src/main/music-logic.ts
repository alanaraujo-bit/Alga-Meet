// Music in a call plays in YouTube's own embedded player (renderer features/music). YouTube refuses to play an embed
// whose page sends no Referer (error 153), and our page is a file:// one, which never sends one. So the embed document
// is requested naming the app by its own API origin: an origin we run, never someone else's domain.

/** The privacy-enhanced embed document, and only it (its scripts and media carry YouTube's own referrer). */
export function isYoutubeEmbed(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && u.hostname === 'www.youtube-nocookie.com' && u.pathname.startsWith('/embed/')
  } catch {
    return false
  }
}

/** YouTube refuses a Referer that is an IP address (error 150): a local API reached by IP is named localhost. */
export function embedReferer(apiUrl: string): string {
  const u = new URL(apiUrl)
  if (u.hostname === '127.0.0.1' || u.hostname === '[::1]') u.hostname = 'localhost'
  return `${u.origin}/`
}
