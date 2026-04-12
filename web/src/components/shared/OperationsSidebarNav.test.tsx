/* @vitest-environment jsdom */

import { HashRouter, Route } from '@solidjs/router';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import OperationsSidebarNav, { type OperationsSidebarItem } from './OperationsSidebarNav';

function mount(
  props: {
    active: string;
    items: OperationsSidebarItem[];
    onChange?: (id: string) => void;
  },
) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const dispose = render(() => (
    <HashRouter
      root={() => (
        <OperationsSidebarNav
          title="Workbench"
          description=""
          items={props.items}
          active={props.active}
          onChange={props.onChange}
        />
      )}
    >
      <Route path="/" component={() => <div>Shell</div>} />
    </HashRouter>
  ), container);

  return () => {
    dispose();
    container.remove();
  };
}

function findItem(id: string): HTMLElement {
  const item = document.querySelector(`[data-operations-nav-id="${id}"]`) as HTMLElement | null;
  expect(item).toBeTruthy();
  return item!;
}

describe('OperationsSidebarNav', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    window.history.replaceState({}, '', '/#/flexinfer');
  });

  it('keeps button-mode semantics for local state changes', () => {
    const onChange = vi.fn();
    const cleanup = mount({
      active: 'overview',
      onChange,
      items: [
        { id: 'overview', label: 'Overview' },
        { id: 'telemetry', label: 'Telemetry' },
      ],
    });

    const telemetry = findItem('telemetry');
    expect(telemetry.tagName).toBe('BUTTON');

    telemetry.click();
    expect(onChange).toHaveBeenCalledWith('telemetry');

    cleanup();
  });

  it('renders router links when an item provides href metadata', async () => {
    const cleanup = mount({
      active: 'overview',
      items: [
        { id: 'overview', label: 'Overview', href: '/flexinfer', replace: true },
        { id: 'telemetry', label: 'Telemetry', href: '/flexinfer?section=telemetry', replace: true },
      ],
    });

    const telemetry = findItem('telemetry');
    expect(telemetry.tagName).toBe('A');
    expect(telemetry.getAttribute('href')).toContain('/flexinfer?section=telemetry');

    telemetry.click();

    await vi.waitFor(() => {
      expect(window.location.hash).toBe('#/flexinfer?section=telemetry');
    });

    cleanup();
  });
});
