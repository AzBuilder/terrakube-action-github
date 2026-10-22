import {fetch, EnvHttpProxyAgent} from 'undici'
import {Credentials} from './auth'
import {Config} from './userInput'

export interface Resource {
  id: string
  type: string
  attributes: Record<string, unknown>
  relationships?: Record<
    string,
    {data: {id: string; type: string}[] | {id: string; type: string} | null}
  >
}
export interface Document {
  data: Resource
  included?: Resource[]
}

export const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

function resource(value: unknown): Resource {
  if (
    !value ||
    typeof value !== 'object' ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    !value.id ||
    !('attributes' in value) ||
    !value.attributes ||
    typeof value.attributes !== 'object' ||
    !('type' in value) ||
    typeof value.type !== 'string'
  ) {
    throw new Error('Malformed Terrakube resource')
  }
  return value as Resource
}

export class TerrakubeClient {
  private readonly dispatcher: EnvHttpProxyAgent
  private variablesSupported = false

  constructor(
    private readonly config: Config,
    private readonly credentials = new Credentials(config),
    private readonly fetcher = fetch,
    private readonly pause = sleep
  ) {
    this.dispatcher = new EnvHttpProxyAgent({
      connect: {rejectUnauthorized: !config.ignoreSslError},
      requestTls: {rejectUnauthorized: !config.ignoreSslError}
    })
  }

  async close(): Promise<void> {
    await this.dispatcher.destroy()
  }

  private async request(
    method: 'GET' | 'POST' | 'PATCH',
    route: string,
    body?: unknown,
    deadline = Infinity,
    logs = false,
    accept = 'application/vnd.api+json'
  ): Promise<string> {
    const url = new URL(`${this.config.endpoint}${route}`)
    const expected = new URL(this.config.endpoint)
    if (
      url.origin !== expected.origin ||
      !url.pathname.startsWith(`${expected.pathname.replace(/\/$/, '')}/`)
    )
      throw new Error('Refusing a request outside the Terrakube endpoint')
    for (let attempt = 0; ; attempt++) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new Error('Polling deadline exceeded')
      const controller = new AbortController()
      const timer = setTimeout(
        () => controller.abort(),
        Math.min(this.config.requestTimeoutMs, remaining)
      )
      try {
        const token = await Promise.race([
          this.credentials.get(controller.signal),
          new Promise<never>((_, reject) =>
            controller.signal.addEventListener(
              'abort',
              () => reject(new Error('Credential request timed out')),
              {once: true}
            )
          )
        ])
        const response = await this.fetcher(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: accept,
            ...(body ? {'Content-Type': 'application/vnd.api+json'} : {})
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
          redirect: 'error',
          dispatcher: this.dispatcher
        })
        if (!response.ok) {
          await response.body?.cancel()
          if (
            method === 'GET' &&
            attempt < 2 &&
            [408, 429, 500, 502, 503, 504].includes(response.status)
          ) {
            clearTimeout(timer)
            await this.pause(
              Math.min(1000 * 2 ** attempt, Math.max(0, deadline - Date.now()))
            )
            continue
          }
          // Error bodies can contain credentials, logs or internal server details.
          throw new Error(
            `Terrakube ${method} returned HTTP ${response.status}`
          )
        }
        if (method === 'PATCH' && response.status === 204) return ''
        const reader = response.body?.getReader()
        if (!reader) throw new Error('Terrakube returned an empty response')
        const chunks: Uint8Array[] = []
        let size = 0
        const limit = logs ? 128_000 : 8_000_000
        try {
          while (true) {
            const {done, value} = await reader.read()
            if (done) break
            const available = limit - size
            chunks.push(value.subarray(0, available))
            size += value.length
            if (size > limit) {
              await reader.cancel()
              if (!logs) throw new Error('Terrakube API response exceeded 8 MB')
              return `${Buffer.concat(chunks).toString('utf8')}\n[Log truncated; see Terrakube for full output.]`
            }
          }
        } finally {
          reader.releaseLock()
        }
        return Buffer.concat(chunks).toString('utf8')
      } catch (error) {
        if (controller.signal.aborted)
          throw new Error('Terrakube request timed out')
        if (method === 'GET' && attempt < 2 && error instanceof TypeError) {
          clearTimeout(timer)
          await this.pause(
            Math.min(1000 * 2 ** attempt, Math.max(0, deadline - Date.now()))
          )
          continue
        }
        if (error instanceof TypeError)
          throw new Error('Terrakube connection failed')
        throw error
      } finally {
        clearTimeout(timer)
      }
    }
  }

  private async json(
    method: 'GET' | 'POST',
    route: string,
    body?: unknown,
    deadline?: number,
    accept = 'application/vnd.api+json'
  ): Promise<Record<string, unknown>> {
    let result: unknown
    try {
      result = JSON.parse(
        await this.request(method, route, body, deadline, false, accept)
      )
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new Error('Terrakube returned invalid JSON')
      throw error
    }
    if (!result || typeof result !== 'object' || 'errors' in result)
      throw new Error('Terrakube returned an API error or malformed document')
    return result as Record<string, unknown>
  }

  async find(
    route: string,
    type: string,
    name: string
  ): Promise<Resource | undefined> {
    // Elide RSQL strings need both literal escaping and URL encoding.
    const literal = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    const query = new URLSearchParams({
      [`filter[${type}]`]: `name=='${literal}'`
    })
    const result = await this.json('GET', `${route}?${query}`)
    if (!Array.isArray(result.data))
      throw new Error(`Malformed ${type} lookup response`)
    const matches = result.data.map(resource)
    if (
      matches.some(item => item.type !== type || item.attributes.name !== name)
    )
      throw new Error(`Unexpected ${type} lookup result`)
    if (matches.length > 1) throw new Error(`Ambiguous ${type} name: ${name}`)
    return matches[0]
  }

  orgRoute(organizationId: string): string {
    return `/api/v1/organization/${encodeURIComponent(organizationId)}`
  }

  async workspace(organizationId: string, id: string): Promise<Resource> {
    const result = await this.json(
      'GET',
      `${this.orgRoute(organizationId)}/workspace/${encodeURIComponent(id)}`
    )
    const item = resource(result.data)
    if (item.type !== 'workspace' || item.id !== id)
      throw new Error('Unexpected workspace response')
    return item
  }

  async createWorkspace(
    organizationId: string,
    name: string,
    folder: string,
    version: string,
    iacType: string,
    sshId?: string
  ): Promise<Resource> {
    const result = await this.json(
      'POST',
      `${this.orgRoute(organizationId)}/workspace`,
      {
        data: {
          type: 'workspace',
          attributes: {
            name,
            source: this.config.repository,
            branch: this.config.workspaceBranch,
            folder,
            terraformVersion: version,
            iacType
          },
          ...(sshId
            ? {relationships: {ssh: {data: {type: 'ssh', id: sshId}}}}
            : {})
        }
      }
    )
    return resource(result.data)
  }

  async checkJobVariables(deadline?: number): Promise<void> {
    if (!Object.keys(this.config.variables).length || this.variablesSupported)
      return
    let supported = false
    try {
      const capabilities = await this.json(
        'GET',
        '/execution/v1/capabilities',
        undefined,
        deadline,
        'application/json'
      )
      supported = capabilities.jobVariables === true
    } catch {
      // Do not submit on an older server that could silently ignore these inputs.
    }
    if (!supported)
      throw new Error(
        'Per-run variables require Terrakube jobVariables support; no job was submitted'
      )
    this.variablesSupported = true
  }

  async createJob(
    organizationId: string,
    workspaceId: string,
    templateId: string,
    deadline?: number
  ): Promise<string> {
    const hasVariables = Object.keys(this.config.variables).length > 0
    await this.checkJobVariables(deadline)
    const result = await this.json(
      'POST',
      `${this.orgRoute(organizationId)}/job`,
      {
        data: {
          type: 'job',
          attributes: {
            ...(hasVariables ? {variables: this.config.variables} : {}),
            templateReference: templateId,
            overrideBranch: this.config.branch,
            ...(this.config.commit ? {commitId: this.config.commit} : {})
          },
          relationships: {
            workspace: {data: {type: 'workspace', id: workspaceId}}
          }
        }
      },
      deadline
    )
    // Capture identity even if a server omits attributes from the creation response.
    const data = result.data as {id?: unknown; type?: unknown} | undefined
    if (!data || typeof data.id !== 'string' || !data.id || data.type !== 'job')
      throw new Error(
        'Job creation returned no job ID; check Terrakube before submitting again'
      )
    return data.id
  }

  async job(
    organizationId: string,
    id: string,
    deadline: number
  ): Promise<Document> {
    const result = await this.json(
      'GET',
      `${this.orgRoute(organizationId)}/job/${encodeURIComponent(id)}?include=step`,
      undefined,
      deadline
    )
    const data = resource(result.data)
    if (
      data.type !== 'job' ||
      data.id !== id ||
      (result.included !== undefined && !Array.isArray(result.included))
    )
      throw new Error('Malformed job/step response')
    const included = ((result.included || []) as unknown[]).map(resource)
    const refs = data.relationships?.step?.data
    const steps = new Map(
      included.filter(item => item.type === 'step').map(step => [step.id, step])
    )
    if (
      !Array.isArray(refs) ||
      refs.some(ref => ref.type !== 'step' || !steps.has(ref.id))
    )
      throw new Error('Job response omitted step information')
    return {data, included: refs.map(ref => steps.get(ref.id) as Resource)}
  }

  async transitionJob(
    organizationId: string,
    id: string,
    status: 'approved' | 'rejected',
    deadline: number
  ): Promise<void> {
    await this.request(
      'PATCH',
      `${this.orgRoute(organizationId)}/job/${encodeURIComponent(id)}`,
      {data: {type: 'job', id, attributes: {status}}},
      deadline
    )
  }

  async context(
    id: string,
    deadline?: number
  ): Promise<Record<string, unknown>> {
    const result = await this.json(
      'GET',
      `/context/v1/${encodeURIComponent(id)}`,
      undefined,
      deadline,
      'application/json'
    )
    return JSON.parse(
      JSON.stringify(result, (_key, value: unknown) =>
        typeof value === 'string'
          ? this.credentials.redact(
              this.config.githubToken
                ? value.replaceAll(this.config.githubToken, '***')
                : value
            )
          : value
      )
    ) as Record<string, unknown>
  }

  async logs(output: string, deadline?: number): Promise<string> {
    const url = new URL(output, `${this.config.endpoint}/`)
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new Error('Invalid Terrakube log URL')
    // Step URLs can name a public host while the runner uses an internal endpoint.
    // Only the log route is retained; credentials always go to the configured API.
    const start = url.pathname.indexOf('/tfoutput/v1/')
    const route = start < 0 ? '' : url.pathname.slice(start)
    if (
      !/^\/tfoutput\/v1\/organization\/[a-z\d-]+\/job\/\d+\/step\/[a-z\d-]+$/i.test(
        route
      )
    )
      throw new Error('Invalid Terrakube log path')
    const text = await this.request(
      'GET',
      `${route}${url.search}`,
      undefined,
      deadline,
      true,
      'application/octet-stream'
    )
    return this.credentials.redact(
      this.config.githubToken
        ? text.replaceAll(this.config.githubToken, '***')
        : text
    )
  }
}
