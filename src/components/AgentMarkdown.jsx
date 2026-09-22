import { Fragment, useMemo } from 'react'
import { parseBlocks, parseInline } from '../lib/agent/markdown'

// ─── An assistant answer, formatted ────────────────────────────────────────
// Shared by the drawer and /agent so the two surfaces cannot drift into
// formatting the same answer differently. Parsing lives in lib/agent/markdown
// and is tested there; this file only maps its tokens to elements.
//
// Every block gets dir="auto": Arak answers in Arabic as readily as English,
// and a right-to-left paragraph laid out left-to-right is unreadable.

function Inline({ tokens }) {
  return tokens.map((t, i) => {
    switch (t.type) {
      case 'strong': return <strong key={i} className="font-semibold text-text"><Inline tokens={t.children} /></strong>
      case 'em':     return <em key={i}><Inline tokens={t.children} /></em>
      case 'strike': return <s key={i}><Inline tokens={t.children} /></s>
      case 'code':
        return (
          <code key={i} className="px-1 py-px rounded bg-surface-muted text-[0.85em] font-mono text-text break-words">
            {t.text}
          </code>
        )
      case 'link':
        return (
          <a key={i} href={t.href} target="_blank" rel="noopener noreferrer"
             className="text-sky-700 underline underline-offset-2 break-all hover:text-sky-900">
            <Inline tokens={t.children} />
          </a>
        )
      default:
        // Single newlines inside a paragraph are meant as line breaks in chat.
        return t.text.split('\n').map((part, j) => (
          <Fragment key={`${i}-${j}`}>{j ? <br /> : null}{part}</Fragment>
        ))
    }
  })
}

const text = s => <Inline tokens={parseInline(s)} />

const HEADING_CLASS = {
  1: 'text-base font-semibold',
  2: 'text-[15px] font-semibold',
  3: 'text-sm font-semibold',
}

function Block({ block }) {
  switch (block.type) {
    case 'heading': {
      const Tag = `h${Math.min(block.level + 2, 6)}`
      return (
        <Tag dir="auto" className={`${HEADING_CLASS[block.level] || 'text-sm font-semibold'} text-text mt-4 first:mt-0`}>
          {text(block.text)}
        </Tag>
      )
    }
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      return (
        <Tag
          dir="auto"
          start={block.ordered && block.start !== 1 ? block.start : undefined}
          className={`${block.ordered ? 'list-decimal' : 'list-disc'} ps-5 space-y-1 marker:text-text-tertiary`}
        >
          {block.items.map((item, i) => (
            <li key={i} style={item.depth ? { marginInlineStart: `${item.depth * 1.25}rem` } : undefined}
                className={item.depth ? 'list-[circle]' : undefined}>
              {text(item.text)}
            </li>
          ))}
        </Tag>
      )
    }
    case 'code':
      return (
        <pre className="text-xs font-mono bg-surface-subtle border border-border rounded-lg p-2.5 overflow-x-auto whitespace-pre">
          <code>{block.text}</code>
        </pre>
      )
    case 'quote':
      return (
        <blockquote dir="auto" className="border-s-2 border-stone-400 ps-3 text-text-secondary">
          {text(block.text)}
        </blockquote>
      )
    case 'table':
      return (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs border-collapse">
            <thead className="bg-surface-subtle">
              <tr>
                {block.header.map((h, i) => (
                  <th key={i} dir="auto" className="text-start font-semibold text-text px-2.5 py-1.5 border-b border-border">
                    {text(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="border-t border-border-light first:border-t-0">
                  {block.header.map((_, c) => (
                    <td key={c} dir="auto" className="px-2.5 py-1.5 align-top text-text">{text(row[c] ?? '')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'rule':
      return <hr className="border-border" />
    default:
      return <p dir="auto">{text(block.text)}</p>
  }
}

export function AgentMarkdown({ children, className = '' }) {
  const blocks = useMemo(() => parseBlocks(children), [children])
  if (!blocks.length) return null
  return (
    <div className={`text-sm text-text leading-relaxed space-y-2.5 break-words ${className}`}>
      {blocks.map((b, i) => <Block key={i} block={b} />)}
    </div>
  )
}
