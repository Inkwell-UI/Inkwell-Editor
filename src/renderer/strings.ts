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
  fontsTitle: 'Fonts',
  fontsNone: 'No text layers built yet',
  fontsCols: { swf: 'SWF', layer: 'Layer', figma: 'Figma font', style: 'Text style', alias: 'Skyrim alias', via: 'Resolved by' },
  unmapped: 'unmapped',
  lintTitle: 'Lint',
  lintNone: 'No issues',
  lintCols: { severity: 'Severity', code: 'Code', message: 'Message', swf: 'SWF', layer: 'Layer' },
  buildStates: { idle: 'Idle', compiling: 'Compiling', synced: 'Synced', error: 'Error' }
} as const
