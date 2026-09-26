import { IRequestStrict, IRequest, RequestHandler } from '../../src/types'
import { IttyRouter } from '../../src/IttyRouter'

type UserRequest = {
  user: string
} & IRequestStrict

type PetRequest = {
  pet: string
} & IRequestStrict

// we define a *strict* router for this demo
const router = IttyRouter<IRequestStrict>()

// middleware with explicit request-type (generic)
const withUser: RequestHandler<UserRequest> = (request) => {
  request.user = 'Kevin'
}

// middleware with explicit request-type (generic)
const withPet = (request: PetRequest) => {
  request.pet = 'Halsey'
}

router
  // request will be IRequestStrict here, thus no user property
  .get('/', (request) => {
    request.user = 'Kevin' // invalid
  })

  // then we add the middleware defined above, allowing the handler chain to inherit the request type
  .all<UserRequest & PetRequest>('*', withUser, withPet, (request) => {
    request.user = 'Kevin'  // should work
    request.pet = 'Halsey' // should work
  })

  // request will be back to IRequestStrict here, thus no user property
  .get('/', (request) => {
    request.user = 'Kevin' // invalid
  })

  // and if we ever need to restore control, add the generic back in
  .get<UserRequest>('/', (request) => {
    request.user = 'Kevin'
  })

export default router
