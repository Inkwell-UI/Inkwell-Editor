import { Search } from 'lucide-react'

/** The filter field of the Navigator, shared by every panel with a list to filter (`label.search`: filled field, search icon, accent border on focus). */
export function SearchBox({ value, onChange, label, className, testId, autoFocus }: { value: string; onChange(v: string): void; label: string; className?: string; testId?: string; autoFocus?: boolean }) {
  return (
    <label className={`search${className ? ` ${className}` : ''}`}>
      <Search size={14} aria-hidden="true" />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={label} aria-label={label} data-testid={testId} autoFocus={autoFocus} />
    </label>
  )
}
