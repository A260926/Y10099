import express from 'express'
import { Router, error, json } from 'itty-router'
import 'isomorphic-fetch'
import { createServerAdapter } from '@whatwg-node/server'

const app = express()

const router = Router()

router.get('/', () => 'Success!')
router.all('*', () => error(404))

const handle = (request) => router.fetch(request).then(json).catch(error)

const ittyServer = createServerAdapter(handle)
app.use(ittyServer.handle)

app.listen(3001)
console.log('listening at https://localhost:3001')
