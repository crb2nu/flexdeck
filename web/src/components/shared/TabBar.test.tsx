/* @vitest-environment jsdom */

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TabBar from './TabBar';

describe('TabBar', () => {
  let container: HTMLDivElement;
  let dispose: () => void;

  function mount(active = 'alerts') {
    const onChange = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    dispose = render(
      () => (
        <TabBar
          tabs={[
            { id: 'alerts', label: 'Alerts', color: 'status-error', count: 2 },
            { id: 'history', label: 'History', color: 'status-ok' },
          ]}
          active={active}
          onChange={onChange}
          variant="underline"
        />
      ),
      container,
    );
    return onChange;
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

  it('uses roving tab stops and activates the next tab with ArrowRight', () => {
    const onChange = mount();
    const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));

    expect(tabs[0].tabIndex).toBe(0);
    expect(tabs[1].tabIndex).toBe(-1);

    tabs[0].focus();
    const dispatched = tabs[0].dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    }));

    expect(dispatched).toBe(false);
    expect(onChange).toHaveBeenCalledWith('history');
    expect(document.activeElement).toBe(tabs[1]);
  });

  it.each([
    ['ArrowLeft', 'alerts'],
    ['Home', 'alerts'],
  ])('wraps or jumps to the first tab with %s', (key, expected) => {
    const onChange = mount('history');
    const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));

    tabs[1].focus();
    tabs[1].dispatchEvent(new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
    }));

    expect(onChange).toHaveBeenCalledWith(expected);
    expect(document.activeElement).toBe(tabs[0]);
  });

  it('jumps to the last tab with End', () => {
    const onChange = mount();
    const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));

    tabs[0].focus();
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', {
      key: 'End',
      bubbles: true,
      cancelable: true,
    }));

    expect(onChange).toHaveBeenCalledWith('history');
    expect(document.activeElement).toBe(tabs[1]);
  });
});
