export interface WebReaderInput {
  url: string
  mode?: 'article' | 'raw_html' | 'text' | 'metadata'
  maxLength?: number
  headers?: Record<string, string>
}

export interface WebMetadata {
  ogTitle?: string
  ogDescription?: string
  ogImage?: string
  contentType?: string
  lang?: string
}

export interface WebReaderResult {
  ok: boolean
  url: string
  status: number
  title: string
  description: string
  content: string
  length: number
  links: string[]
  images: string[]
  metadata: WebMetadata
  error?: string
}

export async function readWebPage(
  input: WebReaderInput,
  signal?: AbortSignal,
): Promise<WebReaderResult> {
  const targetUrl = input.url.trim()
  const mode = input.mode ?? 'article'
  const maxLen = input.maxLength ?? 50_000

  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    return {
      ok: false,
      url: targetUrl,
      status: 0,
      title: '',
      description: '',
      content: '',
      length: 0,
      links: [],
      images: [],
      metadata: {},
      error: 'Invalid URL scheme. Only http:// and https:// are supported.',
    }
  }

  try {
    const customHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      ...(input.headers ?? {}),
    }

    const requestInit: RequestInit = {
      method: 'GET',
      headers: customHeaders,
    }
    if (signal) {
      requestInit.signal = signal
    }

    const response = await fetch(targetUrl, requestInit)

    const status = response.status
    const contentType = response.headers.get('content-type') ?? ''

    if (!response.ok) {
      return {
        ok: false,
        url: targetUrl,
        status,
        title: '',
        description: '',
        content: '',
        length: 0,
        links: [],
        images: [],
        metadata: { contentType },
        error: `HTTP ${status}: ${response.statusText}`,
      }
    }

    const rawHtml = await response.text()

    if (mode === 'raw_html') {
      const truncated = rawHtml.slice(0, maxLen)
      return {
        ok: true,
        url: targetUrl,
        status,
        title: extractTag(rawHtml, 'title'),
        description: extractMeta(rawHtml, 'description'),
        content: truncated,
        length: truncated.length,
        links: extractLinks(rawHtml, targetUrl),
        images: extractImages(rawHtml, targetUrl),
        metadata: extractAllMetadata(rawHtml, contentType),
      }
    }

    const title = extractTag(rawHtml, 'title') || extractMeta(rawHtml, 'og:title')
    const description = extractMeta(rawHtml, 'description') || extractMeta(rawHtml, 'og:description')
    const metadata = extractAllMetadata(rawHtml, contentType)
    const links = extractLinks(rawHtml, targetUrl)
    const images = extractImages(rawHtml, targetUrl)

    if (mode === 'metadata') {
      return {
        ok: true,
        url: targetUrl,
        status,
        title,
        description,
        content: '',
        length: 0,
        links: links.slice(0, 20),
        images: images.slice(0, 10),
        metadata,
      }
    }

    const cleanContent = cleanHtmlToMarkdown(rawHtml, mode === 'article')
    const finalContent = cleanContent.slice(0, maxLen)

    return {
      ok: true,
      url: targetUrl,
      status,
      title,
      description,
      content: finalContent,
      length: finalContent.length,
      links: links.slice(0, 30),
      images: images.slice(0, 15),
      metadata,
    }
  } catch (err: unknown) {
    const isAbort = err instanceof Error && err.name === 'AbortError'
    return {
      ok: false,
      url: targetUrl,
      status: 0,
      title: '',
      description: '',
      content: '',
      length: 0,
      links: [],
      images: [],
      metadata: {},
      error: isAbort ? 'Request timed out or aborted' : String(err),
    }
  }
}

function extractTag(html: string, tagName: string): string {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i')
  const match = html.match(regex)
  if (!match || !match[1]) return ''
  return cleanInlineText(match[1])
}

function extractMeta(html: string, nameOrProperty: string): string {
  const patterns = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${nameOrProperty}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${nameOrProperty}["']`, 'i'),
  ]
  for (const p of patterns) {
    const match = html.match(p)
    if (match && match[1]) return cleanInlineText(match[1])
  }
  return ''
}

function extractAllMetadata(html: string, contentType: string): WebMetadata {
  return {
    ogTitle: extractMeta(html, 'og:title'),
    ogDescription: extractMeta(html, 'og:description'),
    ogImage: extractMeta(html, 'og:image'),
    contentType,
    lang: extractHtmlLang(html),
  }
}

function extractHtmlLang(html: string): string {
  const match = html.match(/<html[^>]+lang=["']([^"']+)["']/i)
  return match && match[1] ? match[1].trim() : ''
}

function extractLinks(html: string, baseUrl: string): string[] {
  const links: string[] = []
  const regex = /<a[^>]+href=["']([^"'#][^"']*)["'][^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(html)) !== null) {
    const rawHref = match[1]
    if (!rawHref) continue
    try {
      const resolved = new URL(rawHref.trim(), baseUrl).href
      if (!links.includes(resolved) && (resolved.startsWith('http://') || resolved.startsWith('https://'))) {
        links.push(resolved)
      }
    } catch {}
    if (links.length >= 60) break
  }
  return links
}

function extractImages(html: string, baseUrl: string): string[] {
  const images: string[] = []
  const regex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(html)) !== null) {
    const rawSrc = match[1]
    if (!rawSrc) continue
    try {
      const resolved = new URL(rawSrc.trim(), baseUrl).href
      if (!images.includes(resolved) && (resolved.startsWith('http://') || resolved.startsWith('https://'))) {
        images.push(resolved)
      }
    } catch {}
    if (images.length >= 30) break
  }
  return images
}

function cleanInlineText(str: string): string {
  return str
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

export function cleanHtmlToMarkdown(html: string, extractArticleOnly: boolean): string {
  let target = html

  target = target.replace(/<script[\s\S]*?<\/script>/gi, '')
  target = target.replace(/<style[\s\S]*?<\/style>/gi, '')
  target = target.replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
  target = target.replace(/<svg[\s\S]*?<\/svg>/gi, '')
  target = target.replace(/<noscript[\s\S]*?<\/noscript>/gi, '')

  if (extractArticleOnly) {
    const articleMatch = target.match(/<article[\s\S]*?<\/article>/i)
      ?? target.match(/<main[\s\S]*?<\/main>/i)
      ?? target.match(/<div[^>]+(?:class|id)=["'][^"']*(?:article|content|post-body|markdown-body|entry-content)[^"']*["'][\s\S]*?<\/div>/i)

    if (articleMatch && articleMatch[0]) {
      target = articleMatch[0]
    }
  }

  target = target.replace(/<!--[\s\S]*?-->/g, '')
  target = target.replace(/<nav[\s\S]*?<\/nav>/gi, '')
  target = target.replace(/<footer[\s\S]*?<\/footer>/gi, '')
  target = target.replace(/<aside[\s\S]*?<\/aside>/gi, '')

  target = target.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n\n# $1\n\n')
  target = target.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n\n## $1\n\n')
  target = target.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n\n### $1\n\n')
  target = target.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n\n#### $1\n\n')

  target = target.replace(/<br\s*\/?>/gi, '\n')
  target = target.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n\n$1\n\n')
  target = target.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1')

  target = target.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n```\n$1\n```\n')
  target = target.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')

  target = target.replace(/<[^>]+>/g, '')

  return target
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
