import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { createElement, forwardRef, type HTMLAttributes } from 'react'
import { afterEach, vi } from 'vitest'

afterEach(() => cleanup())

Element.prototype.scrollIntoView ??= () => undefined

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => {
  const makeIcon = (name: string) => (props: HTMLAttributes<SVGElement>) =>
    createElement('svg', { ...props, 'aria-hidden': true, 'data-icon': name })

  return {
    IconCheckOutlineRegular: makeIcon('check'),
    IconChevronDownOutlineRegular: makeIcon('chevron-down'),
    IconChevronRightOutlineRegular: makeIcon('chevron-right'),
    IconCloseFillRegular: makeIcon('close'),
    IconDataOutlineRegular: makeIcon('data'),
    IconWarningOutlineRegular: makeIcon('warning'),
    MenuSurface: forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>((props, ref) =>
      createElement('div', { ...props, ref })),
    Input: forwardRef<HTMLInputElement, HTMLAttributes<HTMLInputElement>>((props, ref) =>
      createElement('input', { ...props, ref })),
    StateDot: () => createElement('span', { 'data-testid': 'pending-dot' }),
    rankByName: <T extends { name: string }>(items: readonly T[], query: string): T[] =>
      query === '' ? [...items] : items.filter(item => item.name.toLowerCase().includes(query.toLowerCase())),
    Toast: ({ text }: { text: string }) =>
      createElement('div', { role: 'status', 'data-testid': 'toast' }, text),
  }
})
