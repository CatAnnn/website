import type { DigitalPioneerStandard } from '../config/digitalPioneer'

export function AwardCriteriaList({ standards }: { standards: readonly DigitalPioneerStandard[] }) {
  return (
    <ul className="dp-standard-list" lang="en" translate="no">
      {standards.map(({ title, text, emphasis }) => {
        let offset = 0
        const content = emphasis.map((phrase) => {
          const start = text.indexOf(phrase, offset)
          if (start < 0) return null
          const prefix = text.slice(offset, start)
          offset = start + phrase.length
          return <span key={start}>{prefix}<strong>{phrase}</strong></span>
        })
        return <li key={text}><span>{title && <><strong>{title}</strong><br /><br /></>}{content}{text.slice(offset)}</span></li>
      })}
    </ul>
  )
}
