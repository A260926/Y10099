import { IRequestStrict } from '../../src/types'
import { Router } from '../../src/Router'

type Pet = { name: string }
type List = number[]

const router = Router<IRequestStrict, [Pet]>()

type FooRequest = {
  foo: string
} & IRequestStrict

router
  .get('/basic', () => new Response('Success!'))
  .get('/text', () => 'Success!')
  .get('/text', (request, env) => {
    env.name = 'foo'
    env.bar = 'baz' // invalid
  })
  .get('/', (r, env) => env.foo )
  // .get('/params/:foo', ({ foo }) => foo)              // should NOT work
  .get<FooRequest>('/params/:foo', ({ foo }) => foo)  // should work
  .get('/json', () => ({ foo: 'bar' }))

export default router
