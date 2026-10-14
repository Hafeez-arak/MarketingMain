import { explainFailure } from './failureText'

// A failed row's reason: the plain sentence first, the provider's own text
// one click away. The raw text is kept, not discarded — an exhausted balance
// and a rejected prompt need very different responses, and whoever fixes it
// needs the exact words.
export default function FailureNote({ error, media = 'image', className = '', size = 'xs' }) {
  const { message, raw } = explainFailure(error, { media })
  const text = size === 'sm' ? 'text-[11px]' : 'text-[10px]'
  return (
    <div className={`${text} text-red-600 leading-snug ${className}`}>
      <p>{message}</p>
      {raw && (
        <details className="group mt-0.5">
          <summary className="cursor-pointer list-none marker:content-[''] text-red-400 hover:text-red-600 select-none">
            <span className="group-open:hidden">▸ Details</span>
            <span className="hidden group-open:inline">▾ Details</span>
          </summary>
          <p className="mt-0.5 text-text-tertiary break-all whitespace-pre-wrap text-left">{raw}</p>
        </details>
      )}
    </div>
  )
}
