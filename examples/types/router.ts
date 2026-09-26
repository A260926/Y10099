import { Router } from 'Router'

const router = Router({
  port: 4000,
  before: [],
})

router.finally = () => {} // should NOT work
