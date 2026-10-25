import { createHash, timingSafeEqual } from 'node:crypto'

/** Design spec, Security: the Figma bridge trusts a plugin credential, not a pasted token. Only the SHA-256 of an approved secret is ever stored. */
export const hashSecret = (secret: string): string => createHash('sha256').update(secret, 'utf8').digest('hex')

/** At most one prompt per this long, measured from the start of the previous one. */
export const PROMPT_GAP_MS = 60_000

export interface TrustStore {
  /** SHA-256 hex digests of approved secrets. */
  hashes(): readonly string[]
  add(hash: string): Promise<void>
}
export interface ApprovalRequest {
  pluginVersion: string
  fileName: string
  origin: string
}
export type Decision = 'known' | 'allowed' | 'denied' | 'busy' | 'cancelled'

/**
 * Who may speak on the bridge. Lives as long as the editor session (not the sync server, which restarts per project), so a denied secret
 * stays refused and the prompt rate limit holds when another project is opened.
 */
export function createTrust(opts: {
  store: TrustStore
  /** Shows the prompt; resolves true for Allow. `signal` aborts when the socket closed or timed out (the prompt must go away). */
  ask(req: ApprovalRequest, signal: AbortSignal): Promise<boolean>
}) {
  const denied = new Set<string>()
  let active = false
  let lastStart = -Infinity
  const isKnown = (hash: string): boolean => {
    const want = Buffer.from(hash, 'hex')
    let found = false
    for (const h of opts.store.hashes()) {
      const have = Buffer.from(h, 'hex')
      if (have.length === want.length && timingSafeEqual(have, want)) found = true // no early exit: the time does not tell how many are stored
    }
    return found
  }
  return {
    isKnown: (secret: string): boolean => isKnown(hashSecret(secret)),
    /** `onPrompt` runs synchronously once a prompt really starts (the server sends `pending` then). */
    async decide(secret: string, req: ApprovalRequest, signal: AbortSignal, onPrompt: () => void): Promise<Decision> {
      const hash = hashSecret(secret)
      if (isKnown(hash)) return 'known'
      if (denied.has(hash)) return 'denied'
      if (active || Date.now() - lastStart < PROMPT_GAP_MS) return 'busy'
      active = true
      lastStart = Date.now()
      try {
        onPrompt()
        const allow = await opts.ask(req, signal)
        if (signal.aborted) return 'cancelled'
        if (!allow) {
          denied.add(hash)
          return 'denied'
        }
        await opts.store.add(hash)
        return 'allowed'
      } finally {
        active = false
      }
    }
  }
}
export type Trust = ReturnType<typeof createTrust>
