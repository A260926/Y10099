import { error } from 'console'
import { Router } from '../../src/Router'
import { withParams } from '../../src/withParams'
import { IRequest, IRequestStrict, RequestHandler } from '../../src/types'

// we define our environment
type Environment = { age: number }
type Pet = { name: string }

// and now both args combined (that Workers send to the .fetch())
type Args = [Environment]
type AlternativeArgs = [Pet]

const router = Router<IRequestStrict, Args, Response>({
  before: [
    (request, env) => {
      env.age = 123       // valid
      env.foo             // invalid
      request.foo         // invalid
      request.body        // valid
    },
    withParams,
  ],
  catch: error,
  finally: [
    (response, request, env) => {
      response.whatever   // valid (any)
      env.age = 123       // valid
      env.foo             // invalid
      request.foo         // invalid
    },
  ]
})
