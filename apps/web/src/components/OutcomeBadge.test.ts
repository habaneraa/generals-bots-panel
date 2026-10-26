import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Outcome } from '../../../../packages/contracts/src/index';
import { OutcomeBadge } from './OutcomeBadge';

const render = (outcome: Outcome | null) =>
  renderToStaticMarkup(createElement(OutcomeBadge, { outcome }));

describe('OutcomeBadge', () => {
  it('uses the shared light-green and light-red highlights for decided games', () => {
    expect(render('won')).toContain('bg-green-50');
    expect(render('won')).toContain('胜利');
    expect(render('lost')).toContain('bg-red-50');
    expect(render('lost')).toContain('失败');
    expect(render('won')).not.toContain('rounded-full');
  });

  it('marks draws in light yellow and unfinished games in gray', () => {
    expect(render('draw')).toContain('bg-amber-100');
    expect(render('draw')).toContain('平局');
    expect(render('interrupted')).toContain('bg-surface-subtle');
    expect(render(null)).toContain('bg-surface-subtle');
    expect(render(null)).toContain('进行中');
  });
});
