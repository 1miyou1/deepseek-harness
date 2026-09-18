import { describe, it, expect } from 'vitest'
import { cleanHtmlToMarkdown, readWebPage } from '../src/reader.ts'

describe('WebReader Core Engine', () => {
  it('cleans HTML tags and converts headings & paragraphs to markdown', () => {
    const sampleHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>测试文章标题</title>
          <meta name="description" content="这是一篇测试文章的描述信息">
        </head>
        <body>
          <header><nav><a href="/home">首页</a></nav></header>
          <article>
            <h1>核心章节</h1>
            <p>这是第一段内容，包含 <code>内联代码</code> 和 <a href="https://example.com">外部链接</a>。</p>
            <h2>次级章节</h2>
            <p>这是第二段内容。</p>
            <ul>
              <li>特性 1</li>
              <li>特性 2</li>
            </ul>
          </article>
          <footer>页脚版权信息</footer>
        </body>
      </html>
    `

    const result = cleanHtmlToMarkdown(sampleHtml, true)
    expect(result).toContain('# 核心章节')
    expect(result).toContain('## 次级章节')
    expect(result).toContain('`内联代码`')
    expect(result).toContain('- 特性 1')
    expect(result).toContain('- 特性 2')
    expect(result).not.toContain('<article>')
    expect(result).not.toContain('<nav>')
    expect(result).not.toContain('页脚版权信息')
  })

  it('rejects invalid non-http url gracefully', async () => {
    const res = await readWebPage({ url: 'ftp://files.example.com/data' })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('Invalid URL scheme')
  })
})
