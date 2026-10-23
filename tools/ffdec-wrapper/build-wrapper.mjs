// Compiles tools/ffdec-wrapper into build/ffdec-wrapper.jar with a JDK (default C:\dev\jdk, or $INKWELL_JDK).
// --release 8 so the jar runs on the user's JRE 8. ffdec_lib is on the classpath for compiling only; it is not copied into the jar.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = import.meta.dirname
const jdk = process.env.INKWELL_JDK ?? 'C:\\dev\\jdk'
const ffdec = process.env.INKWELL_FFDEC ?? 'C:\\Program Files (x86)\\FFDec'
const bin = (t) => join(jdk, 'bin', t)
if (!existsSync(bin('javac.exe'))) throw new Error(`No JDK at ${jdk} (set INKWELL_JDK)`)
const lib = join(ffdec, 'lib', 'ffdec_lib.jar')
if (!existsSync(lib)) throw new Error(`No ffdec_lib.jar at ${lib} (set INKWELL_FFDEC)`)

const classes = join(root, 'build', 'classes')
rmSync(classes, { recursive: true, force: true })
mkdirSync(classes, { recursive: true })
const dir = resolve(root, 'src/com/inkwell')
const srcs = readdirSync(dir).map((f) => join(dir, f))
execFileSync(bin('javac.exe'), ['--release', '8', '-Xlint:-options', '-cp', lib, '-d', classes, ...srcs], { stdio: 'inherit' })
execFileSync(bin('jar.exe'), ['cf', join(root, 'build', 'ffdec-wrapper.jar'), '-C', classes, '.'], { stdio: 'inherit' })
console.log('built tools/ffdec-wrapper/build/ffdec-wrapper.jar')
