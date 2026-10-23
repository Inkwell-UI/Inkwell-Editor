// All UI strings (English only in 1.0).
import { PRODUCT_NAME } from '../shared/product'

export const strings = {
  windowTitle: PRODUCT_NAME,
  placeholderHeading: `${PRODUCT_NAME} editor`,
  placeholderBody: 'Nothing here yet. Foundations scaffold.',
  overlayTitle: 'Build timing',
  overlayTotal: 'Total',
  overlayMs: 'ms',
  overlayNoBuilds: 'No builds yet',
  syncStarting: 'Starting',
  syncWaiting: 'Waiting for the Figma plugin',
  syncConnected: 'Figma plugin connected',
  syncError: 'Sync server error',
  syncConnection: 'Figma connection',
  syncPort: 'Port',
  syncToken: 'Session token',
  syncCopy: 'Copy',
  syncBuild: 'Build',
  syncLint: 'Lint issues',
  syncSwfs: 'SWFs',
  syncOrphaned: 'orphaned',
  buildStates: { idle: 'Idle', compiling: 'Compiling', synced: 'Synced', error: 'Error' }
} as const
