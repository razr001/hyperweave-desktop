/** Allow platform requests plus renderer-local resources that do not contact a host. */
export function isAllowedPlatformRequest(platformOrigin: string, requestUrl: string): boolean {
  try {
    const request = new URL(requestUrl)
    if (request.protocol === 'data:') return true
    return request.origin === platformOrigin
  } catch {
    return false
  }
}
