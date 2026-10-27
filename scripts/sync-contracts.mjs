// Copies the contract data files (contracts/<menu>/<layer>.json) from the sibling Spec repo into resources/contracts. Run after changing ../Inkwell-Spec/contracts.
import { cpSync, existsSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = resolve(here, '..', '..', 'Inkwell-Spec', 'contracts')
const dst = resolve(here, '..', 'resources', 'contracts')
if (!existsSync(src)) throw new Error(`Contracts not found at ${src}`)
rmSync(dst, { recursive: true, force: true })
cpSync(src, dst, { recursive: true })
console.log(`contracts copied to ${dst}`)
