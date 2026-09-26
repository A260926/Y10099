export const websocket = (client: WebSocket, options?: ResponseInit) =>
  new Response(null, {
    status: 101,
    webSocket: client,
    ...options,
  })
