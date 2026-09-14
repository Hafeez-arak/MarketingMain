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
      case 'strong': return <strong key={i} className="font-semibold text-slate-900"><Inline tokens={t.children} /></strong>
      case 'em':     return <em key={i}><Inline tokens={t.children} /></em>
      case 'strike': return <s key={i}><Inline tokens={t.children} /></s>
      case 'code':
        return (
          <code key={i} className="px-1 py-px rounded bg-slate-100 text-[0.85em] font-mono text-slate-700 break-words">
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
        <Tag dir="auto" className={`${HEADING_CLASS[block.level] || 'text-sm font-semibold'} text-slate-900 mt-4 first:mt-0`}>
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
          className={`${block.ordered ? 'list-decimal' : 'list-disc'} ps-5 space-y-1 marker:text-slate-400`}
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
        <pre className="text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg p-2.5 overflow-x-auto whitespace-pre">
          <code>{block.text}</code>
        </pre>
      )
    case 'quote':
      return (
        <blockquote dir="auto" className="border-s-2 border-slate-300 ps-3 text-slate-600">
          {text(block.text)}
        </blockquote>
      )
    case 'table':
      return (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-xs border-collapse">
            <thead className="bg-slate-50">
              <tr>
                {block.header.map((h, i) => (
                  <th key={i} dir="auto" className="text-start font-semibold text-slate-700 px-2.5 py-1.5 border-b border-slate-200">
                    {text(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="border-t border-slate-100 first:border-t-0">
                  {block.header.map((_, c) => (
                    <td key={c} dir="auto" className="px-2.5 py-1.5 align-top text-slate-700">{text(row[c] ?? '')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'rule':
      return <hr className="border-slate-200" />
    default:
      return <p dir="auto">{text(block.text)}</p>
  }
}

export function AgentMarkdown({ children, className = '' }) {
  const blocks = useMemo(() => parseBlocks(children), [children])
  if (!blocks.length) return null
  return (
    <div className={`text-sm text-slate-800 leading-relaxed space-y-2.5 break-words ${className}`}>
      {blocks.map((b, i) => <Block key={i} block={b} />)}
    </div>
  )
}
