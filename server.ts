import express, { type NextFunction, type Request, type Response } from 'express'
import { createServer as createViteServer } from 'vite'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const port = Number(process.env.PORT ?? 3000)
const upstream = (process.env.API_URL ?? 'https://acceptable-tenderness-production-f1b33822.up.railway.app').replace(/\/$/, '')

app.use(express.json({ limit: '32kb' }))

async function proxyRequest(req: Request, res: Response, next: NextFunction) {
  try {
    const targetPath = req.path.replace(/^\/api/, '') || '/'
    const target = `${upstream}${targetPath}`
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
    const upstreamResponse = await fetch(target, {
      method: req.method,
      headers: hasBody ? { 'content-type': 'application/json' } : undefined,
      body: hasBody ? JSON.stringify(req.body ?? {}) : undefined,
    })

    const contentType = upstreamResponse.headers.get('content-type')
    if (contentType) res.setHeader('content-type', contentType)
    res.status(upstreamResponse.status)
    const body = await upstreamResponse.arrayBuffer()
    res.send(Buffer.from(body))
  } catch (error) {
    next(error)
  }
}

app.get('/api/found', proxyRequest)
app.post('/api/set_network', proxyRequest)
app.post('/api/start', proxyRequest)
app.post('/api/stop', proxyRequest)
app.get('/_app/health', (_req, res) => res.status(200).json({ ok: true }))
app.get('/@vite/client', (_req, res) => res.status(204).end())

if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, 'dist')
  app.use(express.static(distPath))
  app.use((_req, res) => res.sendFile(path.join(distPath, 'index.html')))
} else {
  const vite = await createViteServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'spa',
  })
  app.get('/', async (_req, res, next) => {
    try {
      const template = await readFile(path.join(__dirname, 'index.html'), 'utf8')
      const transformed = await vite.transformIndexHtml('/', template)
      const withoutHmrClient = transformed.replace(/<script[^>]*src=["']\/@vite\/client["'][^>]*><\/script>\s*/g, '')
      res.status(200).type('html').send(withoutHmrClient)
    } catch (error) {
      next(error)
    }
  })
  app.use(vite.middlewares)
}

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error)
  if (!res.headersSent) res.status(502).json({ error: 'Não foi possível alcançar a API externa.' })
})

app.listen(port, '0.0.0.0', () => {
  console.log(`Wallet Recovery Dashboard listening on ${port}`)
})
