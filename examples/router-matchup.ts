import { AutoRouter } from 'AutoRouter'
import { IttyRouter } from 'IttyRouter'
import { Router } from 'Router'
import { IRequest } from 'types'

// setup
type FooResponse = { foo: string }
const request = new Request('https://foo.bar')

// test
const autorouter = AutoRouter<IRequest, [], FooResponse>()
const router = Router<IRequest, [], FooResponse>()
const ittyrouter = IttyRouter<IRequest, [], FooResponse>()

// test getters
autorouter.get('/throw', (a) => a.b.c)
router.get('/throw', (a) => a.b.c)
ittyrouter.get('/throw', (a) => a.b.c)

// autorouter tests
autorouter.missing
autorouter.format

// test response formatting
const autorouterResponse = (await autorouter.fetch(request)).foo
const routerResponse = (await router.fetch(request)).foo
const ittyrouterResponse = (await ittyrouter.fetch(request)).foo

