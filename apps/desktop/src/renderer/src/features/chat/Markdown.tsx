import { memo, type ReactNode } from 'react'
import { openExternal } from '@/lib/clipboard'
import { parseMarkdown, type MdNode } from '@/lib/markdown'
import { useData } from '@/store/data'
import s from './chat.module.css'

const JUMBO = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s){1,24}$/u

function Mention({ id }: { id: string }) {
  const name = useData((st) => st.users[id]?.displayName)
  const isMe = useData((st) => st.me?.id === id)
  return <span className={`${s.mention} ${isMe ? s.mentionMe : ''}`}>@{name ?? 'usuário desconhecido'}</span>
}

function render(nodes: MdNode[], key = ''): ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}${i}`
    switch (n.t) {
      case 'text':
        return n.v
      case 'strong':
        return <strong key={k}>{render(n.c, k)}</strong>
      case 'em':
        return <em key={k}>{render(n.c, k)}</em>
      case 'del':
        return <del key={k}>{render(n.c, k)}</del>
      case 'code':
        return (
          <code key={k} className={s.inlineCode}>
            {n.v}
          </code>
        )
      case 'pre':
        return (
          <pre key={k} className={s.codeBlock} data-lang={n.lang ?? undefined}>
            <code>{n.v}</code>
          </pre>
        )
      case 'link':
        return (
          <a
            key={k}
            href={n.href}
            title={n.href}
            className={s.link}
            onClick={(e) => {
              e.preventDefault()
              openExternal(n.href)
            }}
          >
            {render(n.c, k)}
          </a>
        )
      case 'mention':
        return <Mention key={k} id={n.id} />
    }
  })
}

/** Renders chat markdown as React elements (no HTML injection path). */
export const Markdown = memo(function Markdown({ source }: { source: string }) {
  const jumbo = JUMBO.test(source) && /\p{Extended_Pictographic}/u.test(source)
  return <span className={jumbo ? s.jumbo : undefined}>{render(parseMarkdown(source))}</span>
})
