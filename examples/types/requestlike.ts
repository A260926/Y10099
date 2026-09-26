import { IttyRouter } from 'IttyRouter'

const router = IttyRouter()

const request = new Request('https://foo.bar')

router.fetch(request) // should be OK
router.fetch({ method: 'GET', url: 'foo' }) // should be OK
router.fetch({ method: 'GET' }) // should NOT be OK


