import { Router } from '../../src/Router'
import { IRequest, IRequestStrict, RequestHandler } from '../../src/types'

// we define our environment
type Environment = { age: number }
type Pet = { name: string }

// and now both args combined (that Workers send to the .fetch())
type Args = [Environment]
type AlternativeArgs = [Pet]

// creating some middleware that needs access to CF variables
export const withUser: RequestHandler<IRequest, Args> =
  (request, env) => {
    request.user = 'Kevin'
    env.age = 123
    env.name = 'Kevin' // invalid
  }

const router = Router<IRequestStrict, Args>()

router
  // before middleware
  .get('/', (request, env) => {
    request.user = 'kevin' // invalid (strict)
    env.age = 123 // valid
  })

  // route-level overrides
  .get<IRequest, Args>('/', (request, env) => {
    request.foo = 'bar' // valid
    env.whatever = 123 // invalid
    env.age = 123 // valid
  })
  // route-level overrides
  .get<IRequest, AlternativeArgs>('/', (request, env) => {
    request.foo = 'bar' // valid
    env.age = 123 // invalid
    env.name = 'Mittens' // valid
  })

  // after middleware
  .get('/', withUser, (request, env) => {
    request.user = 'Kevin'
    env.age = 123 // valid
    env.whatever = 123 // invalid
  })

  .get('/', (request, env) => {
    env.age = 'foo' // invalid
  })
