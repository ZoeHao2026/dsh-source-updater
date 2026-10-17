import { describe, expect, it } from 'vitest'
import { orderModelProviders } from '../src/client/provider-order.js'

describe('provider order from DSH 0.2.0-rc.2', () => {
  it('places account and official providers first without reordering custom providers', () => {
    const groups = [
      { id: 'custom-b' },
      { id: 'deepseek-official' },
      { id: 'custom-a' },
      { id: 'deepseek-account' },
    ]
    expect(orderModelProviders(groups).map(group => group.id)).toEqual([
      'deepseek-account', 'deepseek-official', 'custom-b', 'custom-a',
    ])
    expect(groups[0]?.id).toBe('custom-b')
  })
})
