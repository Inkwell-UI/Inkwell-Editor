/** A small (i) marker: the explanation of a control appears on hover or keyboard focus instead of taking a paragraph of its own. */
export function Tip({ text }: { text: string }) {
  return (
    <span className="tip" tabIndex={0} role="img" aria-label={text}>
      <i aria-hidden="true">i</i>
      <span className="tip-text" role="tooltip">{text}</span>
    </span>
  )
}
