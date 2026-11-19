import { strict as assert } from "node:assert"
import http from "node:http"
import { test } from "node:test"

import { hostFetch } from "./host-fetch.ts"

function serve(handler: http.RequestListener): Promise<{ url: string; close(): void }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler).listen(0, "127.0.0.1", () => {
      const address = server.address()
      resolve({ url: `http://127.0.0.1:${address !== null && typeof address === "object" ? address.port : 0}`, close: () => server.close() })
    })
  })
}

test("the Host header and the other headers reach the server, and the answer is read whole", async () => {
  const server = await serve((request, response) => {
    response.setHeader("X-Seen", "yes")
    response.end(JSON.stringify({ host: request.headers.host, ocs: request.headers["ocs-apirequest"], cookie: request.headers.cookie }))
  })
  try {
    const response = await hostFetch(`${server.url}/x`, { headers: { Host: "sky.example", "OCS-APIREQUEST": "true", Cookie: "a=b" } })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("x-seen"), "yes")
    assert.deepEqual(await response.json(), { host: "sky.example", ocs: "true", cookie: "a=b" })
  } finally {
    server.close()
  }
})

test("a redirect is reported, not followed, and a closed port is an error", async () => {
  const server = await serve((_request, response) => {
    response.writeHead(302, { Location: "/login" }).end()
  })
  try {
    assert.equal((await hostFetch(`${server.url}/x`)).status, 302)
  } finally {
    server.close()
  }
  await assert.rejects(hostFetch("http://127.0.0.1:1/x"))
})
