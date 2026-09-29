import { describe, expect, it, mock } from 'bun:test'
import { IttyRouter } from '../src/IttyRouter'
import { Router } from '../src/Router'

const ORIGIN = 'https://example.com'

const toReq = (path: string, method = 'GET') =>
  new Request(`${ORIGIN}${path}`, { method })

type Hit = { called: boolean; params: any; route: string | undefined }

const matchRoute = async (
  RouterCtor: any,
  route: string,
  path: string,
  { method = 'get', base = '' as string } = {},
) => {
  const router = RouterCtor({ base })
  let hit: Hit = { called: false, params: {}, route: undefined }
  router[method](route, (req: any) => {
    hit = { called: true, params: { ...(req.params || {}) }, route: req.route }
  })
  await router.fetch(toReq(path, method.toUpperCase()))
  return hit
}

const noProtoOwnKeys = (obj: any) => Object.getOwnPropertyNames(obj)

describe('router contract: route-string compilation', () => {
  const routers: { name: string; Ctor: (options?: any) => any }[] = [
    { name: 'Router', Ctor: Router },
    { name: 'IttyRouter', Ctor: IttyRouter },
  ]

  for (const { name, Ctor } of routers) {
    describe(name, () => {
      const itPrints = (title: string, fn: () => Promise<void> | void) =>
        it(title, async () => {
          console.log(`  [route-syntax/${name}] ${title}`)
          await fn()
        })

      itPrints('joins base and route, collapsing duplicate slashes', async () => {
        const matched = await matchRoute(Ctor, '/users', '/v1/users', { base: '/v1/' })
        expect(matched.called).toBe(true)
        expect(matched.route).toBe('/v1/users')

        const doubled = await matchRoute(Ctor, '/users', '/v1//users', { base: '/v1/' })
        expect(doubled.called).toBe(false)

        const baseTrailing = await matchRoute(Ctor, 'users', '/v1/users', { base: '/v1/' })
        expect(baseTrailing.called).toBe(true)
        expect(baseTrailing.route).toBe('/v1/users')
      })

      itPrints('collapses internal double slashes and refuses doubled request paths', async () => {
        const clean = await matchRoute(Ctor, '/foo//bar', '/foo/bar')
        expect(clean.called).toBe(true)
        expect(clean.route).toBe('/foo/bar')

        const dirty = await matchRoute(Ctor, '/foo//bar', '/foo//bar')
        expect(dirty.called).toBe(false)
      })

      itPrints('normalizes a trailing slash on the route while matching an optional trailing slash', async () => {
        const without = await matchRoute(Ctor, '/items/', '/items')
        const withSlash = await matchRoute(Ctor, '/items/', '/items/')
        expect(without.called).toBe(true)
        expect(withSlash.called).toBe(true)
        expect(without.route).toBe('/items')
        expect(withSlash.route).toBe('/items')
      })

      itPrints('treats dots literally (no wildcard dot)', async () => {
        const dot = await matchRoute(Ctor, '/data.json', '/data.json')
        const swapped = await matchRoute(Ctor, '/data.json', '/dataXjson')
        expect(dot.called).toBe(true)
        expect(swapped.called).toBe(false)
      })

      itPrints('captures named params and splits name from extension', async () => {
        const single = await matchRoute(Ctor, '/users/:id', '/users/42')
        expect(single.called).toBe(true)
        expect(single.params).toEqual({ id: '42' })
        expect(single.route).toBe('/users/:id')

        const missing = await matchRoute(Ctor, '/users/:id', '/users/')
        expect(missing.called).toBe(false)

        const crossSegment = await matchRoute(Ctor, '/users/:id', '/users/a/b')
        expect(crossSegment.called).toBe(false)

        const ext = await matchRoute(Ctor, '/img/:name.:ext', '/img/cat.png')
        expect(ext.called).toBe(true)
        expect(ext.params).toEqual({ name: 'cat', ext: 'png' })

        const extMismatch = await matchRoute(Ctor, '/img/:name.:ext', '/img/catXpng')
        expect(extMismatch.called).toBe(false)
      })

      itPrints('greedy params span slashes but require at least one segment', async () => {
        const deep = await matchRoute(Ctor, '/files/:path+', '/files/a/b/c.txt')
        expect(deep.called).toBe(true)
        expect(deep.params).toEqual({ path: 'a/b/c.txt' })

        const empty = await matchRoute(Ctor, '/files/:path+', '/files/')
        expect(empty.called).toBe(false)
      })

      itPrints('wildcard is optional: matches with and without the tail', async () => {
        for (const path of ['/assets', '/assets/', '/assets/app/main.js']) {
          const hit = await matchRoute(Ctor, '/assets/*', path)
          expect(hit.called).toBe(true)
        }
        const outside = await matchRoute(Ctor, '/assets/app.js', '/assets/app.js/more')
        expect(outside.called).toBe(false)
      })

      itPrints('routes without a wildcard require the exact path', async () => {
        expect((await matchRoute(Ctor, '/exact', '/exact')).called).toBe(true)
        expect((await matchRoute(Ctor, '/exact', '/exact/extra')).called).toBe(false)
      })

      itPrints('ALL and method-specific routes are checked in registration order', async () => {
        // method-specific registered first wins for both routers; the ALL after never runs
        const specificFirst = Ctor()
        const allAfter = mock(() => 'all')
        specificFirst.get('/res', () => 'specific').all('/res', allAfter)
        expect(await specificFirst.fetch(toReq('/res'))).toBe('specific')
        expect(allAfter).not.toHaveBeenCalled()

        // ALL first: it runs first; what happens next differs by router
        const order: string[] = []
        const allFirst = Ctor()
        allFirst
          .all('/res', () => {
            order.push('all')
          })
          .get('/res', () => {
            order.push('specific')
            return 'specific'
          })
        const response = await allFirst.fetch(toReq('/res'))
        // an ALL handler that returns undefined lets the later matching GET run
        expect(order).toEqual(['all', 'specific'])
        expect(response).toBe('specific')

        // a returning ALL first ends the flow in both routers
        const returningAll = Ctor()
        const laterSpecific = mock(() => 'specific')
        returningAll.all('/res', () => 'all-answer').get('/res', laterSpecific)
        const allResponse = await returningAll.fetch(toReq('/res'))
        // both routers stop the fetch as soon as a matched handler returns non-null
        expect(laterSpecific).not.toHaveBeenCalled()
        expect(allResponse).toBe('all-answer')
      })
    })
  }
})

describe('router contract: query parsing', () => {
  const itPrints = (title: string, fn: () => Promise<void> | void) =>
    it(title, async () => {
      console.log(`  [query] ${title}`)
      await fn()
    })

  itPrints('a repeated key graduates from a single value to an array in encounter order', async () => {
    const router = Router()
    const seen = mock((req: any) => req.query)
    router.get('/search', seen)

    await router.fetch(toReq('/search?tag=a'))
    expect(seen.mock.results[0].value.tag).toBe('a')

    await router.fetch(toReq('/search?tag=a&tag=b'))
    expect(seen.mock.results[1].value.tag).toEqual(['a', 'b'])

    await router.fetch(toReq('/search?tag=a&tag=b&tag=c'))
    expect(seen.mock.results[2].value.tag).toEqual(['a', 'b', 'c'])
  })

  itPrints('keeps empty values as the empty string', async () => {
    const router = Router()
    const seen = mock((req: any) => req.query)
    router.get('/search', seen)

    await router.fetch(toReq('/search?empty=&next=x'))
    const query = seen.mock.results[0].value
    expect(Object.prototype.hasOwnProperty.call(query, 'empty')).toBe(true)
    expect(query.empty).toBe('')
    expect(query.next).toBe('x')
  })

  itPrints('a __proto__ query key does not pollute Object.prototype', async () => {
    const router = Router()
    const seen = mock((req: any) => req.query)
    router.get('/q', seen)

    await router.fetch(toReq('/q?__proto__=polluted&safe=1'))
    const query = seen.mock.results[0].value

    expect(Object.prototype.hasOwnProperty.call(query, '__proto__')).toBe(true)
    expect(query.__proto__).toBe('polluted')
    expect(({} as any).polluted).toBeUndefined()
    expect(Object.getPrototypeOf(query)).toBe(null)
  })

  itPrints('built-in names stay as own keys instead of touching the prototype', async () => {
    const router = Router()
    const seen = mock((req: any) => req.query)
    router.get('/q', seen)

    await router.fetch(toReq('/q?toString=s&hasOwnProperty=h&constructor=c'))
    const query = seen.mock.results[0].value
    expect(noProtoOwnKeys(query).sort()).toEqual(['constructor', 'hasOwnProperty', 'toString'])
    expect(typeof ({} as any).toString).toBe('function')
  })
})

describe('router contract: one Request passed to two routers', () => {
  const itPrints = (title: string, fn: () => Promise<void> | void) =>
    it(title, async () => {
      console.log(`  [shared-request] ${title}`)
      await fn()
    })

  itPrints('second router overwrites params and route instead of reusing the first hit', async () => {
    const first = Router()
    const second = Router()
    first.get('/users/:id', () => 'first')
    second.get('/users/:name', (req: any) => ({ params: req.params, route: req.route }))

    const request = toReq('/users/ada') as any
    await first.fetch(request)
    expect(request.params).toEqual({ id: 'ada' })
    expect(request.route).toBe('/users/:id')

    const result = await second.fetch(request)
    expect(result).toEqual({ params: { name: 'ada' }, route: '/users/:name' })
    expect(request.params).toEqual({ name: 'ada' })
    expect(request.route).toBe('/users/:name')
  })

  itPrints('rebuilds query for the second router instead of reusing the first object', async () => {
    const first = Router()
    const second = Router()
    const firstSeen = mock((req: any): any => req.query)
    const secondSeen = mock((req: any): any => ({ query: req.query, params: req.params, route: req.route }))
    first.get('/a/:id', firstSeen)
    second.all('*', secondSeen)

    const request = toReq('/a/1?from=first&from=again') as any
    await first.fetch(request)
    const firstQuery = firstSeen.mock.results[0].value
    expect(firstQuery).toEqual({ from: ['first', 'again'] })

    const secondHit: any = await second.fetch(request)
    const secondQuery = secondSeen.mock.results[0].value.query
    expect(secondQuery).toEqual({ from: ['first', 'again'] })
    expect(secondQuery).not.toBe(firstQuery)
    expect(request.query).toBe(secondQuery)
    expect(secondHit.params).toEqual({})
    expect(secondHit.route).toBe('*')
    expect(request.params).toEqual({})
    expect(request.route).toBe('*')
  })

  itPrints('second fetch resets when the second router matches more narrowly', async () => {
    const first = Router()
    const second = Router()
    first.all('*', () => 'catchall')
    second.get('/a/:id', (req: any) => ({ params: req.params, route: req.route }))

    const request = toReq('/a/7?x=1') as any
    expect(await first.fetch(request)).toBe('catchall')
    expect(request.route).toBe('*')
    const secondHit = await second.fetch(request)
    expect(secondHit).toEqual({ params: { id: '7' }, route: '/a/:id' })
  })
})

describe('router contract: async control-flow ordering', () => {
  const itPrints = (title: string, fn: () => Promise<void> | void) =>
    it(title, async () => {
      console.log(`  [timing] ${title}`)
      await fn()
    })

  itPrints('before returning false short-circuits; finally still runs; null/undefined fall through', async () => {
    const events: string[] = []
    const routeHandler = mock(() => {
      events.push('route')
      return 'route-response'
    })
    const router = Router({
      before: [
        (req: any) => {
          events.push('before-false')
          req.passed = false
          return false
        },
      ],
      finally: [
        (response: any) => {
          events.push(`finally:${String(response)}`)
        },
      ],
    }).get('/', routeHandler)

    const response = await router.fetch(toReq('/'))
    expect(response).toBe(false)
    expect(routeHandler).not.toHaveBeenCalled()
    expect(events).toEqual(['before-false', 'finally:false'])

    const passthroughEvents: string[] = []
    const passthrough = Router({
      before: [
        () => {
          passthroughEvents.push('before-null')
          return null
        },
      ],
    }).get('/', () => {
      passthroughEvents.push('route')
      return 'ok'
    })
    expect(await passthrough.fetch(toReq('/'))).toBe('ok')
    expect(passthroughEvents).toEqual(['before-null', 'route'])
  })

  itPrints('a route handler returning undefined lets later handlers continue, false stops', async () => {
    const events: string[] = []
    const router = Router()
    router.get(
      '/work',
      () => {
        events.push('h1:undefined')
      },
      () => {
        events.push('h2:false')
        return false
      },
      () => {
        events.push('h3:would-continue')
        return 'final'
      },
    )
    router.get('/work', () => {
      events.push('second-route')
      return 'should-not-win'
    })

    const response = await router.fetch(toReq('/work'))
    // undefined passes through; false is a real response and stops the route loop
    expect(response).toBe(false)
    expect(events).toEqual(['h1:undefined', 'h2:false'])
  })

  itPrints('a false response skips the remaining handlers of the same route', async () => {
    const events: string[] = []
    const router = Router()
    router.get('/w',
      () => { events.push('h1') },
      () => { events.push('h2'); return false },
      () => { events.push('h3'); return 'final' },
    )
    router.all('*', () => { events.push('fallback'); return 'fallback' })

    const response = await router.fetch(toReq('/w'))
    expect(response).toBe(false)
    expect(events).toEqual(['h1', 'h2'])
  })

  itPrints('a zero response skips the remaining handlers of the same route', async () => {
    const events: string[] = []
    const router = Router()
    router.get('/w',
      () => { events.push('h1') },
      () => { events.push('h2'); return 0 as any },
      () => { events.push('h3'); return 'final' },
    )

    const response = await router.fetch(toReq('/w'))
    expect(response).toBe(0)
    expect(events).toEqual(['h1', 'h2'])
  })

  itPrints('a route handler returning false still reaches the finally stage', async () => {
    const events: string[] = []
    const router = Router({
      finally: [
        (response: any) => {
          events.push(`finally:${String(response)}`)
          return response
        },
      ],
    }).get(
      '/work',
      () => {
        events.push('h1:undefined')
      },
      () => {
        events.push('h2:false')
        return false
      },
    )

    expect(await router.fetch(toReq('/work'))).toBe(false)
    expect(events).toEqual(['h1:undefined', 'h2:false', 'finally:false'])
  })

  itPrints('after a route returns undefined, a later matching route still gets the request', async () => {
    const events: string[] = []
    const router = Router()
    router.get('*', (req: any) => {
      req.stamped = true
      events.push('middleware')
    })
    router.get('/item/:id', (req: any) => {
      events.push(`item:${req.params.id}:${req.stamped}`)
      return req.params.id
    })

    const response = await router.fetch(toReq('/item/9'))
    expect(response).toBe('9')
    expect(events).toEqual(['middleware', 'item:9:true'])
  })

  itPrints('a handler throw routes to catch, which sees the matched request view and args', async () => {
    const events: string[] = []
    const afterThrow = mock(() => 'never')
    const boom = Object.assign(new Error('boom'), { code: 500 })
    const extra = { token: 'abc' }
    const catchView: any = {}

    const router = Router({
      catch: (err: any, request: any, arg: any) => {
        events.push(`catch:${err.message}:${request.route}:${request.params.id}:${arg.token}`)
        catchView.route = request.route
        catchView.params = { ...request.params }
        catchView.url = request.url
        catchView.arg = arg
        return 'recovered'
      },
    }).get('/fail/:id',
      (req: any) => {
        events.push(`before-throw:${req.params.id}`)
        throw boom
      },
      afterThrow,
    )

    const response = await router.fetch(toReq('/fail/7'), extra)
    expect(response).toBe('recovered')
    expect(afterThrow).not.toHaveBeenCalled()
    expect(events).toEqual(['before-throw:7', 'catch:boom:/fail/:id:7:abc'])
    expect(catchView).toMatchObject({
      route: '/fail/:id',
      params: { id: '7' },
      url: toReq('/fail/7').url,
      arg: extra,
    })
  })

  itPrints('finally can replace the response, and returning undefined keeps it', async () => {
    const events: string[] = []
    const replacing = Router({
      finally: [
        (response: any) => {
          events.push(`f1:${String(response)}`)
          return response === 'raw' ? 'polished' : undefined
        },
        (response: any) => {
          events.push(`f2:${String(response)}`)
        },
      ],
    }).get('/', () => 'raw')

    expect(await replacing.fetch(toReq('/'))).toBe('polished')
    expect(events).toEqual(['f1:raw', 'f2:polished'])

    const keepEvents: string[] = []
    const keeping = Router({
      finally: [
        () => {
          keepEvents.push('f1:undefined')
          return undefined
        },
        (response: any) => {
          keepEvents.push(`f2:${String(response)}`)
          return 0
        },
        (response: any) => {
          keepEvents.push(`f3:${String(response)}`)
        },
      ],
    }).get('/', () => 'raw')

    expect(await keeping.fetch(toReq('/'))).toBe(0)
    expect(keepEvents).toEqual(['f1:undefined', 'f2:raw', 'f3:0'])
  })

  itPrints('a finally throw is caught by catch and skips remaining finally handlers', async () => {
    const events: string[] = []
    const afterBoom = mock(() => events.push('finally-after-boom'))
    const router = Router({
      finally: [
        (response: any) => {
          events.push(`finally-boom:${String(response)}`)
          throw new Error('finally-broke')
        },
        afterBoom,
      ],
      catch: (err: any, request: any) => {
        events.push(`catch:${err.message}:${request.route}`)
        return 'caught-finally'
      },
    }).get('/x', () => 'from-route')

    const response = await router.fetch(toReq('/x'))
    expect(response).toBe('caught-finally')
    expect(afterBoom).not.toHaveBeenCalled()
    expect(events).toEqual(['finally-boom:from-route', 'catch:finally-broke:/x'])
  })

  itPrints('every layer receives request.proxy when present, in exact order', async () => {
    const events: string[] = []
    const seen: Record<string, any> = {}
    const record = (stage: string) => (response: any, request: any) => {
      seen[stage] = request
      events.push(stage)
      return response
    }

    const request = toReq('/boom') as any
    const proxy = new Proxy(request, { get: (t, p) => Reflect.get(t, p) })
    request.proxy = proxy

    const router = Router({
      before: [
        (req: any) => {
          seen.before = req
          events.push('before')
        },
      ],
      catch: (err: any, req: any) => {
        seen.catch = req
        events.push('catch')
        return 'caught'
      },
      finally: [record('finally')],
    }).get('/boom', (req: any) => {
      seen.route = req
      events.push('route')
      throw new Error('x')
    })

    const response = await router.fetch(request)
    expect(response).toBe('caught')
    expect(events).toEqual(['before', 'route', 'catch', 'finally'])
    for (const stage of ['before', 'route', 'catch', 'finally']) {
      expect(seen[stage]).toBe(proxy)
    }
  })

  itPrints('a proxy installed inside before is used from the route stage onward', async () => {
    const events: string[] = []
    const seen: Record<string, any> = {}
    let proxy: any

    const router = Router({
      before: [
        (request: any) => {
          seen.before = request
          events.push('before')
          proxy = new Proxy(request, { get: (t, p) => Reflect.get(t, p) })
          request.proxy = proxy
        },
      ],
      finally: [
        (response: any, request: any) => {
          seen.finally = request
          events.push('finally')
          return response
        },
      ],
    }).get('/ok', (request: any) => {
      seen.route = request
      events.push('route')
      return 'ok'
    })

    const request = toReq('/ok') as any
    expect(await router.fetch(request)).toBe('ok')
    expect(events).toEqual(['before', 'route', 'finally'])
    expect(seen.before).toBe(request)
    expect(seen.route).toBe(proxy)
    expect(seen.finally).toBe(proxy)
  })

  itPrints('without request.proxy every layer receives the original request', async () => {
    const events: string[] = []
    const seen: Record<string, any> = {}
    const router = Router({
      before: [
        (request: any) => {
          seen.before = request
          events.push('before')
        },
      ],
      finally: [
        (response: any, request: any) => {
          seen.finally = request
          events.push('finally')
          return response
        },
      ],
    }).get('/ok', (request: any) => {
      seen.route = request
      events.push('route')
      return 'ok'
    })

    const request = toReq('/ok')
    expect(await router.fetch(request)).toBe('ok')
    expect(events).toEqual(['before', 'route', 'finally'])
    expect(seen.before).toBe(request)
    expect(seen.route).toBe(request)
    expect(seen.finally).toBe(request)
  })
})
