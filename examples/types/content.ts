import { IRequestStrict, IRequest, RequestHandler } from 'types'
import { IttyRouter } from 'IttyRouter'
import { withContent } from 'withContent'
import { HasContent } from 'types'

type User = {
  user: string
}

const router = IttyRouter()

router
  // upstream request sees the request as IRequest (default), so anything goes
  .post<HasContent<User>>('/', withContent, ({ content }) => {
    content.user
  })

  .get('/pollution', (request) => {
    request.content.user
  })

export default router
