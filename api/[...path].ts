const DEFAULT_API_URL = 'https://acceptable-tenderness-production-f1b33822.up.railway.app'

function pathFromQuery(value: unknown) {
  if (Array.isArray(value)) return value.join('/')
  return typeof value === 'string' ? value : ''
}

export default async function handler(req: any, res: any) {
  const upstream = String(process.env.API_URL || DEFAULT_API_URL).replace(/\/$/, '')
  const path = pathFromQuery(req.query?.path)
  const target = `${upstream}/${path}`
  const isBodyRequest = req.method !== 'GET' && req.method !== 'HEAD'

  try {
    const response = await fetch(target, {
      method: req.method,
      headers: isBodyRequest ? { 'content-type': 'application/json' } : undefined,
      body: isBodyRequest
        ? typeof req.body === 'string'
          ? req.body
          : JSON.stringify(req.body ?? {})
        : undefined,
    })

    const contentType = response.headers.get('content-type')
    if (contentType) res.setHeader('content-type', contentType)
    res.status(response.status).send(Buffer.from(await response.arrayBuffer()))
  } catch (error) {
    console.error('API proxy error', error)
    res.status(502).json({ error: 'Não foi possível alcançar a API externa.' })
  }
}
