import { describe, expect, it } from 'bun:test'
import { IttyRouter } from '../src/IttyRouter'
import { Router as FlowRouter } from '../src/Router'

const ROOT = 'https://example.com'

const req = (methodAndPath: string) => {
  const [method, path] = methodAndPath.split(' ')
  return new Request(`${ROOT}${path ?? method}`, {
    method: path ? method : 'GET',
  })
}

type AnyRouter = {
  routes: any[]
  fetch: (request: any, ...args: any[]) => Promise<any>
  all: (route: string, ...handlers: any[]) => AnyRouter
  get: (route: string, ...handlers: any[]) => AnyRouter
}
type RouterFactory = (...args: any[]) => AnyRouter

const routers: { name: string; Router: RouterFactory }[] = [
  { name: 'IttyRouter', Router: IttyRouter as RouterFactory },
  { name: 'Router (flow)', Router: FlowRouter as RouterFactory },
]

// Contract expectations below are hand-written: they must never be derived
// from the route-compilation regexes living in the router implementation.

const syntaxMatrix = [
  {
    name: 'repeated slashes across base and route are collapsed',
    base: '/api//',
    route: '/v1//users',
    registeredPath: '/api/v1/users',
    path: '/api/v1/users',
    params: {},
  },
  {
    name: 'a trailing slash matches the same path without it',
    base: '',
    route: '/widgets/',
    registeredPath: '/widgets',
    path: '/widgets',
    params: {},
  },
  {
    name: 'a registered path without trailing slash matches with one',
    base: '',
    route: '/widgets',
    registeredPath: '/widgets',
    path: '/widgets/',
    params: {},
  },
  {
    name: 'dots are matched literally, not as any character',
    base: '',
    route: '/files/:name.:ext',
    registeredPath: '/files/:name.:ext',
    path: '/files/photo.png',
    params: { name: 'photo', ext: 'png' },
  },
  {
    name: 'a dot in the route never matches a non-dot character',
    base: '',
    route: '/files/:name.:ext',
    registeredPath: '/files/:name.:ext',
    path: '/files/photoXpng',
    miss: true,
  },
  {
    name: 'named params capture one segment and expose groups',
    base: '/:collection',
    route: '/items/:id',
    registeredPath: '/:collection/items/:id',
    path: '/todos/items/42',
    params: { collection: 'todos', id: '42' },
  },
  {
    name: 'greedy params span multiple segments',
    base: '',
    route: '/files/:path+',
    registeredPath: '/files/:path+',
    path: '/files/a/b/c.txt',
    params: { path: 'a/b/c.txt' },
  },
  {
    name: 'greedy params require at least one character',
    base: '',
    route: '/files/:path+',
    registeredPath: '/files/:path+',
    path: '/files/',
    miss: true,
  },
  {
    name: 'an absent optional wildcard matches the bare prefix',
    base: '',
    route: '/items/*',
    registeredPath: '/items/*',
    path: '/items',
    params: {},
  },
  {
    name: 'a present wildcard consumes nested segments',
    base: '',
    route: '/items/*',
    registeredPath: '/items/*',
    path: '/items/1/2/3',
    params: {},
  },
]

describe('route-string compilation contract', () => {
  for (const { name: routerName, Router } of routers) {
    describe(routerName, () => {
      for (const scenario of syntaxMatrix) {
        it(scenario.name, async () => {
          const calls: any[] = []
          const router = Router({ base: scenario.base })
          router.get(scenario.route, (request: any) => {
            calls.push(request.params)
            return request.params
          })

          expect(router.routes[0][3]).toBe(scenario.registeredPath)

          const response = await router.fetch(req(`GET ${scenario.path}`))

          if (scenario.miss) {
            expect(calls).toHaveLength(0)
            expect(response).toBeUndefined()
          } else {
            expect(calls).toHaveLength(1)
            expect(response).toEqual(scenario.params)
          }
        })
      }

      it('the first registered matching route wins regardless of method type', async () => {
        const events: string[] = []
        const router = Router()
        router.all('/thing', () => { events.push('all'); return 'all' })
        router.get('/thing', () => { events.push('get'); return 'get' })

        await router.fetch(req('/thing'))

        expect(events).toEqual(['all'])
      })

      it('a specific method registered earlier wins over a later ALL route', async () => {
        const events: string[] = []
        const router = Router()
        router.get('/thing', () => { events.push('get'); return 'get' })
        router.all('/thing', () => { events.push('all'); return 'all' })

        await router.fetch(req('/thing'))

        expect(events).toEqual(['get'])
      })

      it('ALL still matches requests whose method has no dedicated route', async () => {
        const events: string[] = []
        const router = Router()
        router.get('/thing', () => { events.push('get'); return 'get' })
        router.all('/thing', () => { events.push('all'); return 'all' })

        await router.fetch(req('POST /thing'))

        expect(events).toEqual(['all'])
      })
    })
  }
})

describe('query-string contract', () => {
  for (const { name: routerName, Router } of routers) {
    describe(routerName, () => {
      const collect = async (search: string) => {
        let seen: any
        const router = Router()
        router.get('/report', (request: any) => {
          seen = request.query
        })
        await router.fetch(new Request(`${ROOT}/report${search}`))
        return seen
      }

      it('a repeated key changes from a single value to an array', async () => {
        const once = await collect('?tag=a')
        expect(once.tag).toBe('a')

        const twice = await collect('?tag=a&tag=b')
        expect(twice.tag).toEqual(['a', 'b'])
        expect(Array.isArray(twice.tag)).toBe(true)

        const thrice = await collect('?tag=a&tag=b&tag=c')
        expect(thrice.tag).toEqual(['a', 'b', 'c'])
      })

      it('an empty value is preserved', async () => {
        const query = await collect('?empty=&kept=v')
        expect(Object.prototype.hasOwnProperty.call(query, 'empty')).toBe(true)
        expect(query.empty).toBe('')
        expect(query.kept).toBe('v')
      })

      it('an empty first occurrence is replaced (not concatenated) by the next value', async () => {
        const query = await collect('?a=&a=2')
        expect(query.a).toBe('2')
      })

      it('a "__proto__" key is an own property and never pollutes Object.prototype', async () => {
        const query = await collect('?__proto__=evil&normal=ok')

        expect(Object.prototype.hasOwnProperty.call(query, '__proto__')).toBe(true)
        expect(query['__proto__']).toBe('evil')
        expect(Object.getPrototypeOf(query)).toBeNull()
        expect(({} as any).evil).toBeUndefined()
        expect(({} as any)['__proto__']).toBe(Object.prototype)
      })
    })
  }
})

describe('one Request reused across two routers', () => {
  for (const { name: routerName, Router } of routers) {
    it(routerName + ': the second hit leaves no params, route or query residue', async () => {
      const request: any = new Request(`${ROOT}/owners/9/pets/7?tag=first&tag=second`)

      const ownerRouter = Router()
      ownerRouter.get('/owners/:ownerId/pets/:petId', (request: any) => ({
        params: request.params,
        route: request.route,
        query: request.query,
      }))

      const petRouter = Router()
      petRouter.get('/owners/:owner/pets/:pet', (request: any) => ({
        params: request.params,
        route: request.route,
        query: request.query,
      }))

      const first: any = await ownerRouter.fetch(request)
      expect(first.params).toEqual({ ownerId: '9', petId: '7' })
      expect(first.route).toBe('/owners/:ownerId/pets/:petId')
      expect(first.query.tag).toEqual(['first', 'second'])

      const second: any = await petRouter.fetch(request)
      expect(second.params).toEqual({ owner: '9', pet: '7' })
      expect(second.params).not.toHaveProperty('ownerId')
      expect(second.params).not.toHaveProperty('petId')
      expect(Object.keys(second.params).sort()).toEqual(['owner', 'pet'])
      expect(second.route).toBe('/owners/:owner/pets/:pet')
      expect(second.query.tag).toEqual(['first', 'second'])
      expect(second.query).not.toHaveProperty('stale')

      request.query.stale = true
      const third: any = await petRouter.fetch(request)
      expect(third.query).not.toHaveProperty('stale')
      expect(third.query.tag).toEqual(['first', 'second'])
    })
  }
})

describe('async control-flow contract (Router)', () => {
  it('before short-circuits on an empty string and still runs finally', async () => {
    const events: string[] = []
    const router = FlowRouter({
      before: [
        () => { events.push('before-1') },
        () => {
          events.push('before-2')
          return ''
        },
        () => { events.push('before-3') },
      ],
      finally: [
        (response) => {
          events.push(`finally:${String(response)}`)
        },
      ],
    })
    router.get('/', () => { events.push('route') })

    const response = await router.fetch(req('/'))

    expect(events).toEqual(['before-1', 'before-2', 'finally:'])
    expect(response).toBe('')
  })

  it('before short-circuits on false', async () => {
    const events: string[] = []
    const router = FlowRouter({
      before: [
        () => {
          events.push('before')
          return false
        },
      ],
    })
    router.get('/', () => { events.push('route') })

    const response = await router.fetch(req('/'))

    expect(events).toEqual(['before'])
    expect(response).toBe(false)
  })

  it('before does NOT short-circuit on null/undefined (0 still stops)', async () => {
    const events: string[] = []
    const router = FlowRouter({
      before: [
        () => {
          events.push('before-null')
        },
        () => {
          events.push('before-zero')
          return 0
        },
        () => { events.push('after-zero') },
      ],
    })
    router.get('/', () => {
      events.push('route')
      return 'done'
    })

    const response = await router.fetch(req('/'))

    expect(events).toEqual(['before-null', 'before-zero'])
    expect(response).toBe(0)
  })

  it('a route handler returning undefined continues to later routes/handlers', async () => {
    const events: string[] = []
    const router = FlowRouter()
    router.get(
      '/chain/:id?',
      (request) => {
        events.push(`middleware:${request.params.id ?? 'none'}`)
      },
      () => { events.push('undefined-handler') },
    )
    router.get('/chain/:id?', (request) => {
      events.push(`terminal:${request.params.id}`)
      return `ok:${request.params.id}`
    })

    const response = await router.fetch(req('/chain/13'))

    expect(events).toEqual([
      'middleware:13',
      'undefined-handler',
      'terminal:13',
    ])
    expect(response).toBe('ok:13')
  })

  it('catch sees the error, the request view and args; later stages are skipped', async () => {
    const events: any[] = []
    const failure = new Error('boom')
    const context = { ctx: true }
    let caughtRequest: any
    let rawRequest: any
    const router = FlowRouter({
      catch: (error, request, arg) => {
        caughtRequest = request
        events.push(['catch', error === failure, arg])
        return 'recovered'
      },
      finally: [
        (response) => { events.push(`finally:${response}`) },
      ],
    })
    router.get(
      '/boom',
      (request) => {
        rawRequest = request
        request.proxy = new Proxy(request, {
          get: (target, prop) =>
            prop === 'proxyMark' ? 'catch-marker' : (target as any)[prop],
        })
        events.push('before-throw')
      },
      () => {
        throw failure
      },
      () => { events.push('after-throw') },
    )

    const response = await router.fetch(req('/boom'), context)

    expect(events).toEqual([
      'before-throw',
      ['catch', true, context],
      'finally:recovered',
    ])
    expect(response).toBe('recovered')
    expect(caughtRequest.proxyMark).toBe('catch-marker')
    expect(rawRequest.proxyMark).toBeUndefined()
  })

  it('finally may replace the response and sees responses piped in order', async () => {
    const events: string[] = []
    const router = FlowRouter({
      finally: [
        (response) => {
          events.push(`f1:${response}`)
          return 'first'
        },
        (response) => {
          events.push(`f2:${response}`)
          return 42
        },
      ],
    })
    router.get('/', () => 'original')

    const response = await router.fetch(req('/'))

    expect(events).toEqual(['f1:original', 'f2:first'])
    expect(response).toBe(42)
  })

  it('finally returning undefined keeps the existing response (even "")', async () => {
    const events: string[] = []
    const router = FlowRouter({
      before: [
        () => '',
      ],
      finally: [
        (response) => {
          events.push(`observe:${JSON.stringify(response)}`)
        },
        (response) => {
          events.push(`passthrough:${JSON.stringify(response)}`)
          return undefined
        },
      ],
    })
    router.get('/', () => 'should-never-run')

    const response = await router.fetch(req('/'))

    expect(events).toEqual(['observe:""', 'passthrough:""'])
    expect(response).toBe('')
  })

  it('an error thrown inside finally is handled by catch', async () => {
    const events: any[] = []
    const failure = new Error('finally-boom')
    let caughtRequest: any
    let rawRequest: any
    const router = FlowRouter({
      finally: [
        () => {
          events.push('finally-1')
          throw failure
        },
        () => { events.push('finally-2') },
      ],
      catch: (error, request) => {
        caughtRequest = request
        events.push(['catch', error === failure])
        return 'caught'
      },
    })
    router.get('/', (request) => {
      rawRequest = request
      request.proxy = new Proxy(request, {
        get: (target, prop) =>
          prop === 'proxyMark' ? 'finally-marker' : (target as any)[prop],
      })
      events.push('route')
      return 'original'
    })

    const response = await router.fetch(req('/'))

    expect(events).toEqual(['route', 'finally-1', ['catch', true]])
    expect(response).toBe('caught')
    expect(caughtRequest.proxyMark).toBe('finally-marker')
    expect(rawRequest.proxyMark).toBeUndefined()
  })

  it('a static request.proxy is what before, route, catch and finally receive', async () => {
    const identities: Record<string, boolean> = {}
    const events: string[] = []
    const proxy = {}
    const router = FlowRouter({
      before: [
        (received: any) => {
          identities.before = received === proxy
        },
      ],
      catch: (_error: unknown, received: any) => {
        identities.catch = received === proxy
        return 'recovered'
      },
      finally: [
        (response: any, received: any) => {
          identities.finally = received === proxy
          events.push(`finally:${response}`)
        },
      ],
    })
    router.get('/', (received: any) => {
      identities.route = received === proxy
      events.push('route')
      throw new Error('x')
    })

    const request: any = req('/')
    request.proxy = proxy

    const response = await router.fetch(request)

    expect(events).toEqual(['route', 'finally:recovered'])
    expect(identities).toEqual({
      before: true,
      route: true,
      catch: true,
      finally: true,
    })
    expect(response).toBe('recovered')
  })

  it('a proxy attached mid-route is used by the next layer and by finally', async () => {
    const identities: Record<string, boolean> = {}
    const events: string[] = []
    const router = FlowRouter({
      finally: [
        (_response: unknown, received: any) => {
          identities.finally = received?.tag === 'dynamic'
        },
      ],
    })
    router.get(
      '/',
      (received: any) => {
        identities.beforeProxySet =
          received instanceof Request && (received as any).tag === undefined
        received.proxy = new Proxy(received, {
          get: (target, prop) => (prop === 'tag' ? 'dynamic' : (target as any)[prop]),
        })
        events.push('set')
      },
      (received: any) => {
        identities.nextHandler = received.tag === 'dynamic'
        events.push('use')
        return 'done'
      },
    )

    const response = await router.fetch(req('/'))

    expect(events).toEqual(['set', 'use'])
    expect(identities).toEqual({
      beforeProxySet: true,
      nextHandler: true,
      finally: true,
    })
    expect(response).toBe('done')
  })
})
