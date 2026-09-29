/*
 * Zero-dependency mutation check for test/router-contract.test.ts.
 *
 * For every mutation below we temporarily rewrite a single condition inside
 * src/Router.ts (and src/IttyRouter.ts where the same route compiler lives),
 * run the contract tests with `bun test`, then restore the source.  A
 * mutation is "killed" when at least one contract test fails.  The source is
 * always restored (even if the script is interrupted) and the final summary
 * is written to artifacts/router-mutations.txt.
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ROUTER = join(root, 'src', 'Router.ts')
const ITTY = join(root, 'src', 'IttyRouter.ts')
const CONTRACT_TEST = join(root, 'test', 'router-contract.test.ts')
const ARTIFACT = join(root, 'artifacts', 'router-mutations.txt')
const BUN = process.execPath.endsWith('bun') ? process.execPath : 'bun'

type Target = { file: string; find: string; replace: string; occurrences?: number }
type Mutation = { id: string; category: string; description: string; targets: Target[] }

const mutations: Mutation[] = [
  {
    id: 'M1',
    category: 'route compilation',
    description: 'stop collapsing repeated/trailing slashes when joining base + route',
    targets: [
      {
        file: ROUTER,
        find: '.replace(/\\/+(\\/|$)/g, \'$1\')',
        replace: '.replace(/NEVER_MATCH_XYZ/g, \'$1\')',
      },
      {
        file: ITTY,
        find: '.replace(/\\/+(\\/|$)/g, \'$1\')',
        replace: '.replace(/NEVER_MATCH_XYZ/g, \'$1\')',
      },
    ],
  },
  {
    id: 'M2',
    category: 'route compilation',
    description: 'require the wildcard segment to be present (breaks absent wildcard match)',
    targets: [
      {
        file: ROUTER,
        find: '.replace(/(\\/?)\\*/g, \'($1.*)?\')',
        replace: '.replace(/(\\/?)\\*/g, \'($1.*)\')',
      },
      {
        file: ITTY,
        find: '.replace(/(\\/?)\\*/g, \'($1.*)?\')',
        replace: '.replace(/(\\/?)\\*/g, \'($1.*)\')',
      },
    ],
  },
  {
    id: 'M3',
    category: 'route compilation',
    description: 'do not escape dots so "." matches any character',
    targets: [
      { file: ROUTER, find: '.replace(/\\./g, \'\\\\.\')', replace: '.replace(/NO_DOT_ESCAPE_XYZ/g, \'$&\')' },
      { file: ITTY, find: '.replace(/\\./g, \'\\\\.\')', replace: '.replace(/NO_DOT_ESCAPE_XYZ/g, \'$&\')' },
    ],
  },
  {
    id: 'M4',
    category: 'route compilation',
    description: 'make greedy params non-greedy so only one segment is captured',
    targets: [
      {
        file: ROUTER,
        find: '.replace(/(\\/?\\.?):(\\w+)\\+/g, \'($1(?<$2>[^]+))\')',
        replace: '.replace(/(\\/?\\.?):(\\w+)\\+/g, \'($1(?<$2>[^$1/]+?))\')',
      },
      {
        file: ITTY,
        find: '.replace(/(\\/?\\.?):(\\w+)\\+/g, \'($1(?<$2>[^]+))\')',
        replace: '.replace(/(\\/?\\.?):(\\w+)\\+/g, \'($1(?<$2>[^$1/]+?))\')',
      },
    ],
  },
  {
    id: 'M5',
    category: 'query parsing',
    description: 'reverse repeated-key concatenation order',
    targets: [
      {
        file: ROUTER,
        find: 'query[k] ? ([] as string[]).concat(query[k], v) : v',
        replace: 'query[k] ? ([] as string[]).concat(v, query[k]) : v',
      },
      {
        file: ITTY,
        find: 'query[k] ? ([] as string[]).concat(query[k], v) : v',
        replace: 'query[k] ? ([] as string[]).concat(v, query[k]) : v',
      },
    ],
  },
  {
    id: 'M6',
    category: 'query parsing',
    description: 'drop the null prototype on the parsed query object (prototype pollution)',
    targets: [
      { file: ROUTER, find: '{ __proto__: null }\n\n      // 1. parse query params', replace: '{}\n\n      // 1. parse query params' },
      { file: ITTY, find: '{ __proto__: null }\n\n      // 1. parse query params', replace: '{}\n\n      // 1. parse query params' },
    ],
  },
  {
    id: 'M7',
    category: 'query parsing',
    description: 'parse into a fresh object without reassigning request.query (stale keys survive)',
    targets: [
      { file: ROUTER, find: 'query: Record<string, any> = request.query = {', replace: 'query: Record<string, any> = {' },
      { file: ITTY, find: 'query: Record<string, any> = request.query = {', replace: 'query: Record<string, any> = {' },
    ],
  },
  {
    id: 'M8',
    category: 'control flow',
    description: 'treat only false (not empty string/0) as a response',
    targets: [
      { file: ROUTER, find: ') != null) break t', replace: ') === false) break t' },
      { file: ROUTER, find: ') != null) break outer', replace: ') === false) break outer' },
    ],
  },
  {
    id: 'M9',
    category: 'control flow',
    description: 'finally replaces the response even when a handler returns undefined',
    targets: [
      {
        file: ROUTER,
        find: 'response = await handler(response, request.proxy ?? request, ...args) ?? response',
        replace: 'response = await handler(response, request.proxy ?? request, ...args)',
      },
    ],
  },
  {
    id: 'M10',
    category: 'control flow',
    description: 'always rethrow errors thrown from finally instead of routing them to catch',
    targets: [
      {
        file: ROUTER,
        find: '      } catch(err: any) {\n        if (!other.catch) throw err',
        replace: '      } catch(err: any) {\n        if (other.catch || true) throw err',
      },
    ],
  },
  {
    id: 'M11',
    category: 'request view',
    description: 'handlers always receive the raw request instead of request.proxy',
    targets: [
      {
        file: ROUTER,
        find: 'request.proxy ?? request, ...args',
        replace: 'request, ...args',
        occurrences: 5,
      },
    ],
  },
  {
    id: 'M12',
    category: 'request view',
    description: 'keep stale params from a previous router hit instead of overwriting them',
    targets: [
      {
        file: ROUTER,
        find: 'request.params = match.groups || {}',
        replace: 'request.params = request.params || match.groups || {}',
      },
      {
        file: ITTY,
        find: 'request.params = match.groups || {}',
        replace: 'request.params = request.params || match.groups || {}',
      },
    ],
  },
]

const read = (file: string) => readFileSync(file, 'utf8')
const write = (file: string, content: string) => writeFileSync(file, content)
const sha = (content: string) => createHash('sha256').update(content).digest('hex').slice(0, 12)

const originals = new Map<string, string>([
  [ROUTER, read(ROUTER)],
  [ITTY, read(ITTY)],
])

const restoreAll = () => {
  for (const [file, content] of originals) write(file, content)
}

process.on('exit', restoreAll)
process.on('SIGINT', () => {
  restoreAll()
  process.exit(130)
})

const runContractTests = () => {
  const result = spawnSync(
    BUN,
    ['test', CONTRACT_TEST],
    { cwd: root, encoding: 'utf8' },
  )
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  const failing = Array.from(
    new Set(
      Array.from(output.matchAll(/\(fail\) (.+)/g)).map((match) => match[1].trim()),
    ),
  )
  return {
    killed: result.status !== 0,
    failing,
  }
}

const applyTargets = (targets: Target[], apply: boolean) => {
  for (const target of targets) {
    const content = read(target.file)
    const [search, substitute] = apply
      ? [target.find, target.replace]
      : [target.replace, target.find]
    const count = content.split(search).length - 1
    if (count === 0) {
      throw new Error(
        `mutation anchor not found while ${apply ? 'applying' : 'restoring'} ${target.file}: ${search}`,
      )
    }
    if (apply && target.occurrences && count !== target.occurrences) {
      throw new Error(
        `anchor for mutation appears ${count} time(s), expected ${target.occurrences}: ${target.find}`,
      )
    }
    write(target.file, content.split(search).join(substitute))
  }
}

// Every anchor must be present in the untouched baseline before we start.
for (const mutation of mutations) {
  for (const target of mutation.targets) {
    const content = originals.get(target.file)!
    const count = content.split(target.find).length - 1
    if (count === 0) {
      throw new Error(
        `baseline anchor missing for ${mutation.id} in ${target.file}: ${target.find}`,
      )
    }
    if (target.occurrences && count !== target.occurrences) {
      throw new Error(
        `baseline anchor for ${mutation.id} appears ${count} time(s), expected ${target.occurrences}`,
      )
    }
  }
}

const lines: string[] = []
const log = (line: string) => {
  console.log(line)
  lines.push(line)
}

log(`itty-router contract mutation check`)
log(`baseline hash  src/Router.ts    ${sha(originals.get(ROUTER)!)}`)
log(`baseline hash  src/IttyRouter.ts ${sha(originals.get(ITTY)!)}`)
log('')

const baseline = runContractTests()
if (baseline.killed) {
  log('BASELINE contract run is red before any mutation; aborting.')
  for (const failure of baseline.failing) log(`  (fail) ${failure}`)
  restoreAll()
  process.exit(1)
}
log('baseline: contract tests green')
log('')

const categories = new Set<string>()
let killedCount = 0

for (const mutation of mutations) {
  categories.add(mutation.category)
  try {
    applyTargets(mutation.targets, true)
    const outcome = runContractTests()
    applyTargets(mutation.targets, false)

    if (outcome.killed) {
      killedCount++
      log(`${mutation.id}  KILLED  [${mutation.category}] ${mutation.description}`)
      for (const failure of outcome.failing) log(`        ✗ ${failure}`)
    } else {
      log(`${mutation.id}  SURVIVED  [${mutation.category}] ${mutation.description}`)
    }
  } catch (error) {
    applyTargets(mutation.targets, false)
    log(`${mutation.id}  ERROR  [${mutation.category}] ${(error as Error).message}`)
  }
}

let restored = true
for (const [file, content] of originals) {
  if (read(file) !== content) {
    restored = false
    log(`WARNING: ${file} was not restored correctly`)
  }
}

const after = runContractTests()
log('')
log(`summary: ${killedCount}/${mutations.length} mutations killed across ${categories.size} categories`)
log(`categories: ${Array.from(categories).join(' | ')}`)
log(`source restored: ${restored && !after.killed ? 'yes (contract tests green again)' : 'NO'}`)

mkdirSync(dirname(ARTIFACT), { recursive: true })
writeFileSync(ARTIFACT, `${lines.join('\n')}\n`)
console.log(`\nwrote ${ARTIFACT}`)

restoreAll()
process.exit(killedCount === mutations.length && restored && !after.killed ? 0 : 1)
