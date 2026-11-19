/**
 * `fetch` that can set the `Host` header, which the global one ignores: the Node server asks the Nextcloud container by its
 * address on the container network (`http://nextcloud:80`) while Nextcloud only answers to its public name, so the name goes
 * in `Host`. Plain `http`/`https`, buffered, with a timeout; redirects are never followed (the caller reads the status).
 */
import http from 'node:http'
import https from 'node:https'

const TIMEOUT_MS = 5000

export function hostFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input))
  const headers: Record<string, string> = {}
  new Headers(init.headers).forEach((value, name) => {
    headers[name] = value
  })
  return new Promise((resolve, reject) => {
    const send = url.protocol === 'https:' ? https.request : http.request
    const request = send(url, { method: init.method ?? 'GET', headers, timeout: TIMEOUT_MS }, (incoming) => {
      const chunks: Buffer[] = []
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
      incoming.on('error', reject)
      incoming.on('end', () => {
        const answer = new Headers()
        for (const [name, value] of Object.entries(incoming.headers)) {
          for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) answer.append(name, one)
        }
        const status = incoming.statusCode ?? 502
        const body = status === 204 || status === 304 ? null : Buffer.concat(chunks)
        resolve(new Response(body, { status, headers: answer }))
      })
    })
    request.on('timeout', () => request.destroy(new Error(`${url.host} did not answer in ${TIMEOUT_MS} ms`)))
    request.on('error', reject)
    request.end()
  })
}
