import type { BaseNextRequest } from '../../../base-http'
import type { NodeNextRequest } from '../../../base-http/node'
import type { WebNextRequest } from '../../../base-http/web'
import type { ServerResponse } from 'node:http'

import { getRequestMeta } from '../../../request-meta'
import { fromNodeOutgoingHttpHeaders } from '../../utils'
import { NextRequest } from '../request'

// It's not possible to detect a client abort from the request object, but it
// is possible to detect when they close their end of the response.
export function signalFromNodeResponse(res: ServerResponse) {
  const { errored, closed } = res
  if (errored || closed) return AbortSignal.abort(errored || undefined)

  const controller = new AbortController()

  // If finish fires, then `res.end()` has been called already. If close fires
  // first, then we know the client disconnected before we finished.
  function onClose() {
    controller.abort()
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    res.off('finish', onFinish)
  }
  function onFinish() {
    res.off('close', onClose)
  }
  res.once('close', onClose)
  res.once('finish', onFinish)

  return controller.signal
}

export class NextRequestAdapter {
  public static fromBaseNextRequest(
    request: BaseNextRequest,
    signal: AbortSignal
  ): NextRequest {
    // TODO: look at refining this check
    if ('request' in request && (request as WebNextRequest).request) {
      return NextRequestAdapter.fromWebNextRequest(request as WebNextRequest)
    }

    return NextRequestAdapter.fromNodeNextRequest(
      request as NodeNextRequest,
      signal
    )
  }

  public static fromNodeNextRequest(
    request: NodeNextRequest,
    signal: AbortSignal
  ): NextRequest {
    // HEAD and GET requests can not have a body.
    let body: BodyInit | null = null
    if (request.method !== 'GET' && request.method !== 'HEAD' && request.body) {
      // @ts-expect-error - this is handled by undici, when streams/web land use it instead
      body = request.body
    }

    let url: URL
    if (request.url.startsWith('http')) {
      url = new URL(request.url)
    } else {
      // Grab the full URL from the request metadata.
      const base = getRequestMeta(request, '__NEXT_INIT_URL')
      if (!base || !base.startsWith('http')) {
        // Because the URL construction relies on the fact that the URL provided
        // is absolute, we need to provide a base URL. We can't use the request
        // URL because it's relative, so we use a dummy URL instead.
        url = new URL(request.url, 'http://n')
      } else {
        url = new URL(request.url, base)
      }
    }

    return new NextRequest(url, {
      body,
      method: request.method,
      headers: fromNodeOutgoingHttpHeaders(request.headers),
      // @ts-expect-error - see https://github.com/whatwg/fetch/pull/1457
      duplex: 'half',
      signal,
      // geo
      // ip
      // nextConfig
    })
  }

  public static fromWebNextRequest(request: WebNextRequest): NextRequest {
    // HEAD and GET requests can not have a body.
    let body: ReadableStream | null = null
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      body = request.body
    }

    return new NextRequest(request.url, {
      body,
      method: request.method,
      headers: fromNodeOutgoingHttpHeaders(request.headers),
      // @ts-expect-error - see https://github.com/whatwg/fetch/pull/1457
      duplex: 'half',
      signal: request.request.signal,
      // geo
      // ip
      // nextConfig
    })
  }
}
