#!/usr/bin/env bun
/*
 * Contract-mutation driver (no external tools, Bun only).
 *
 * For each mutation below we:
 *   1. patch a single key condition in src/Router.ts (or src/IttyRouter.ts)
 *   2. run `bun test test/router-contract.test.ts`
 *   3. require the contract suite to turn RED (kill)
 *   4. restore the source immediately
 * After every mutation we verify the file bytes are back to the original,
 * and at the end a pristine baseline run must be GREEN again.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const srcRouter = join(root, 'src/Router.ts')
const srcItty = join(root, 'src/IttyRouter.ts')
const contractTest = join(root, 'test/router-contract.test.ts')
const artifact = join(root, 'artifacts/router-mutations.txt')

type Mutation = {
  id: string
  category: string
  file: string
  find: string
  replace: string
  expected: string
  all?: boolean
}

const mutateOnce = (text: string, find: string, replace: string, all = false) => {
  const hits = text.split(find).length - 1
  if (!all && hits !== 1) throw new Error(`expected exactly 1 occurrence, found ${hits}: ${find}`)
  if (all && hits < 1) throw new Error(`expected at least 1 occurrence, found 0: ${find}`)
  return all ? text.split(find).join(replace) : text.replace(find, replace)
}

const mutations: Mutation[] = [
  {
    id: 'M1-slash-collapse',
    category: 'route compilation',
    file: srcRouter,
    find: `.replace(/\\/+(\\/|$)/g, '$1'))`,
    replace: `.replace(/\\/+(\\/|$)/g, '$&'))`,
    expected: 'duplicate slashes between base and route leak into the regex',
  },
  {
    id: 'M2-dot-escape',
    category: 'route compilation',
    file: srcRouter,
    find: `.replace(/\\./g, '\\\\.')`,
    replace: `.replace(/\\./g, '.')`,
    expected: 'a dot in a route matches any character (/dataXjson matches /data.json)',
  },
  {
    id: 'M3-greedy-separator',
    category: 'route compilation',
    file: srcRouter,
    find: `'($1(?<$2>[^$1/]+?))'`,
    replace: `'($1(?<$2>[^]+?))'`,
    expected: 'named params swallow slashes and match empty segments',
  },
  {
    id: 'M4-wildcard-required',
    category: 'route compilation',
    file: srcRouter,
    find: `'($1.*)?'`,
    replace: `'($1.*)'`,
    expected: 'the wildcard tail becomes mandatory (/assets no longer matches /assets/*)',
  },
  {
    id: 'M5-query-no-array',
    category: 'query parsing',
    file: srcRouter,
    find: `query[k] = query[k] ? ([] as string[]).concat(query[k], v) : v`,
    replace: `query[k] = v`,
    expected: 'repeated query keys stay a single (last) value instead of an array',
  },
  {
    id: 'M6-query-null-proto',
    category: 'query parsing',
    file: srcRouter,
    find: `request.query = { __proto__: null }`,
    replace: `request.query = {}`,
    expected: '__proto__ / built-in query keys can touch the real prototype chain',
  },
  {
    id: 'M7-before-falsy-shortcircuit',
    category: 'async control flow',
    file: srcRouter,
    find: `!= null) break t`,
    replace: `!== false) break t`,
    expected: 'a before handler returning the empty string (or 0) stops the flow incorrectly',
  },
  {
    id: 'M8-route-undefined-continue',
    category: 'async control flow',
    file: srcRouter,
    find: `!= null) break outer`,
    replace: `== null) break outer`,
    expected: 'inverted guard: undefined stops the flow while false/0 continue to the next handler',
  },
  {
    id: 'M9-finally-undefined-keeps',
    category: 'async control flow',
    file: srcRouter,
    find: `...args) ?? response`,
    replace: `...args) || response`,
    expected: 'a finally handler returning 0 is treated as "no replacement"',
  },
  {
    id: 'M10-method-order',
    category: 'method ordering',
    file: srcItty,
    find: `method == request.method || method == 'ALL'`,
    replace: `method == request.method`,
    expected: 'ALL routes never match, breaking registration-order precedence',
  },
  {
    id: 'M11-proxy-propagation',
    category: 'request proxy',
    file: srcRouter,
    find: `request.proxy ?? request`,
    replace: `request`,
    all: true,
    expected: 'handlers receive the raw request instead of request.proxy',
  },
]

const runContractTests = () =>
  spawnSync('bun', ['test', contractTest], { cwd: root, encoding: 'utf8' })

const summarize = (result: ReturnType<typeof runContractTests>) => {
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  const passLine = output.match(/(\d+) pass/)
  const failLine = output.match(/(\d+) fail/)
  const failedNames = [...output.matchAll(/\(fail\) (.+)/g)].map((m) => m[1].trim())
  return {
    exit: result.status ?? -1,
    pass: passLine ? Number(passLine[1]) : 0,
    fail: failLine ? Number(failLine[1]) : 0,
    failedNames,
  }
}

const originals = new Map<string, string>()
for (const file of new Set(mutations.map((m) => m.file))) {
  originals.set(file, readFileSync(file, 'utf8'))
}

const lines: string[] = []
const log = (line: string) => {
  console.log(line)
  lines.push(line)
}

log('itty-router contract mutation run')
log(`generated: ${new Date().toISOString()}`)
log(`suite:     ${contractTest.replace(root + '/', '')}`)
log('='.repeat(78))

let killed = 0
let survived = 0
const categoryKilled = new Set<string>()

for (const mutation of mutations) {
  const original = originals.get(mutation.file)!
  const patched = mutateOnce(original, mutation.find, mutation.replace, mutation.all)
  writeFileSync(mutation.file, patched)
  let summary: ReturnType<typeof summarize>
  try {
    summary = summarize(runContractTests())
  } finally {
    writeFileSync(mutation.file, original)
  }
  const restored = readFileSync(mutation.file, 'utf8') === original
  const isKilled = summary.exit !== 0 && summary.fail > 0
  if (isKilled) {
    killed++
    categoryKilled.add(mutation.category)
  } else {
    survived++
  }
  log(
    `${isKilled ? 'KILLED' : 'SURVIVED'}  ${mutation.id.padEnd(26)} [${mutation.category}] ` +
      `${summary.fail} failing / ${summary.pass} passing | restored=${restored}`,
  )
  log(`          why it should break: ${mutation.expected}`)
  for (const name of summary.failedNames.slice(0, 4)) {
    log(`          red: ${name}`)
  }
}

const pristine = [...originals.entries()].every(
  ([file, text]) => readFileSync(file, 'utf8') === text,
)
const baseline = summarize(runContractTests())

log('='.repeat(78))
log(`mutations killed:   ${killed}/${mutations.length}`)
log(`mutations survived: ${survived}`)
log(
  `categories killed:  ${categoryKilled.size} ` +
    `(${[...categoryKilled].sort().join(', ')})`,
)
log(`source restored:    ${pristine}`)
log(`baseline rerun:     ${baseline.fail === 0 && baseline.exit === 0 ? 'GREEN' : 'RED'} ` +
    `(${baseline.pass} passing, ${baseline.fail} failing)`)
log('='.repeat(78))
const success = killed === mutations.length && survived === 0 && pristine &&
  baseline.exit === 0 && baseline.fail === 0 && categoryKilled.size >= 4
log(success ? 'RESULT: ALL MUTATIONS KILLED - suite is mutation-safe' : 'RESULT: FAILURE')

writeFileSync(artifact, lines.join('\n') + '\n')
console.log(`\nsummary written to ${artifact.replace(root + '/', '')}`)

process.exit(success ? 0 : 1)
