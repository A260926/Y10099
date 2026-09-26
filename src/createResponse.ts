import { ResponseFormatter } from './types'

 export const createResponse =
  (
    format = 'text/plain; charset=utf-8',
    transform?: (body: any) => any,
  ): ResponseFormatter =>
  (body, options = {}) => {
    if (body === undefined || body instanceof Response) return body

    // @ts-ignore
    const response = new Response(transform?.(body) ?? body, options.url ? undefined : options)
    response.headers.set('content-type', format)
    return response
  }
