import { relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Allow platform requests plus renderer-local resources that do not contact a host. */
export function isAllowedPlatformRequest(platformOrigin: string, requestUrl: string, uiRoot?: string): boolean {
  try {
    const request = new URL(requestUrl)
    if (request.protocol === 'data:') return true
    if (request.origin === platformOrigin) return true
    if (request.protocol !== 'file:' || !uiRoot) return false
    const root = resolve(uiRoot)
    const target = resolve(fileURLToPath(request))
    const pathFromRoot = relative(root, target)
    return pathFromRoot === 'index.html' || (pathFromRoot !== '' && !pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..')
  } catch {
    return false
  }
}
