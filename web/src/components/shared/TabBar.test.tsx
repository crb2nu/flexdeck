/* @vitest-environment jsdom */

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TabBar from './TabBar';

describe('TabBar', () => {
  let container: HTMLDivElement;
  let dispose: () => void;

  function mount() {
    container = document.createElement('div');
    document.body.appendChild(container);
    dispose = render(
      () => (
        <TabBar
          tabs={[
            { id: 'alerts', label: 'Alerts', color: 'status-error', count: 2 },
            { id: 'history', label: 'History', color: 'status-ok' },
          ]}
          active="alerts"
          onChange={vi.fn()}
          variant="underline"
        />
      ),
      container,
    );
  }

  afterEach(() => {
    dispose?.();
    container?.remove();
    document.body.innerHTML = '';
  });

  it('uses static classes for active underline tones', () => {
    mount();

    const activeTab = container.querySelector('[role="tab"][aria-selected="true"]') as HTMLButtonElement | null;

    expect(activeTab).toBeTruthy();
    expect(activeTab?.type).toBe('button');
    expect(activeTab?.className).toContain('border-status-error');
    expect(activeTab?.className).toContain('text-status-error');
    expect(activeTab?.className).not.toContain('border-${');
  });
});
