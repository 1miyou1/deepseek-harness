import { describe, expect, it, vi } from 'vitest'
import { runVerifiedAgent } from '../src/index.ts'

describe('runVerifiedAgent', () => {
  it('returns after the first accepted validation', async () => {
    const run = vi.fn().mockResolvedValue('first')
    const validate = vi.fn().mockResolvedValue({ ok: true })
    const retryTask = vi.fn().mockReturnValue(undefined)

    await expect(runVerifiedAgent({ task: 'original', run, validate, retryTask })).resolves.toEqual({
      value: 'first', validation: { ok: true }, attempts: 1,
    })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('runs exactly one retry task after rejected validation', async () => {
    const run = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second')
    const validate = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true })
    const retryTask = vi.fn().mockReturnValue('repair')

    await expect(runVerifiedAgent({ task: 'original', run, validate, retryTask })).resolves.toEqual({
      value: 'second', validation: { ok: true }, attempts: 2,
    })
    expect(run).toHaveBeenNthCalledWith(1, 'original')
    expect(run).toHaveBeenNthCalledWith(2, 'repair')
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('propagates execution errors without retrying', async () => {
    const failure = new Error('model unavailable')
    const run = vi.fn().mockRejectedValue(failure)
    const validate = vi.fn()
    const retryTask = vi.fn()

    await expect(runVerifiedAgent({ task: 'original', run, validate, retryTask })).rejects.toBe(failure)
    expect(run).toHaveBeenCalledTimes(1)
    expect(validate).not.toHaveBeenCalled()
    expect(retryTask).not.toHaveBeenCalled()
  })

  it('propagates host validation errors without retrying', async () => {
    const failure = new Error('validation unavailable')
    const run = vi.fn().mockResolvedValue('first')
    const validate = vi.fn().mockRejectedValue(failure)
    const retryTask = vi.fn()

    await expect(runVerifiedAgent({ task: 'original', run, validate, retryTask })).rejects.toBe(failure)
    expect(run).toHaveBeenCalledTimes(1)
    expect(retryTask).not.toHaveBeenCalled()
  })
})
