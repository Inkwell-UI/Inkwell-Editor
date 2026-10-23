export type LintSeverity = 'error' | 'warning' | 'info'

/** One compiler finding. `nodeId` is the Figma node id (the IR key), so the UI can link back to the layer. */
export interface LintIssue {
  severity: LintSeverity
  code: string
  message: string
  nodeId: string
}

export const issue = (severity: LintSeverity, code: string, nodeId: string, message: string): LintIssue => ({ severity, code, message, nodeId })
