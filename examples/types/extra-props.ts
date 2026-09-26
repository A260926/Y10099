import { IRequestStrict, IRequest, RequestHandler } from 'types'
import { IttyRouter } from 'IttyRouter'
import { withContent } from 'withContent'
import { HasContent } from 'types'

const router = IttyRouter({
  port: 3000,
})

router.port = 4000
router.port.toLowerCase()
router.puppy() // should not be typed... RIP

