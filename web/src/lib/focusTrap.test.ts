/* @vitest-environment jsdom */

import { afterEach, describe, expect, it } from 'vitest';
import { trapFocus } from './focusTrap';

function tabEvent(shiftKey = false): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: 'Tab', shiftKey, cancelable: true });
}

describe('trapFocus', () => {
  let container: HTMLDivElement;

  function mount(html: string): HTMLDivElement {
    container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    return container;
  }

  afterEach(() => {
    container?.remove();
  });

  it('ignores non-Tab keys and missing containers', () => {
    const el = mount('<button id="a">a</button>');
    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    trapFocus(el, escape);
    expect(escape.defaultPrevented).toBe(false);
    trapFocus(undefined, tabEvent());
  });

  it('wraps forward Tab from the last focusable to the first', () => {
    const el = mount('<button id="first">a</button><button id="last">b</button>');
    (el.querySelector('#last') as HTMLElement).focus();
    const e = tabEvent();
    trapFocus(el, e);
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('first');
  });

  it('wraps Shift+Tab from the first focusable to the last', () => {
    const el = mount('<button id="first">a</button><button id="last">b</button>');
    (el.querySelector('#first') as HTMLElement).focus();
    const e = tabEvent(true);
    trapFocus(el, e);
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('last');
  });

  it('lets mid-dialog Tab proceed untouched', () => {
    const el = mount('<button id="first">a</button><button id="mid">b</button><button id="last">c</button>');
    (el.querySelector('#mid') as HTMLElement).focus();
    const e = tabEvent();
    trapFocus(el, e);
    expect(e.defaultPrevented).toBe(false);
  });

  it('pulls strayed focus back inside the dialog', () => {
    const outside = document.createElement('button');
    outside.id = 'outside';
    document.body.appendChild(outside);
    const el = mount('<button id="first">a</button><button id="last">b</button>');
    outside.focus();
    const e = tabEvent();
    trapFocus(el, e);
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('first');
    outside.remove();
  });

  it('skips disabled controls and blocks Tab when nothing is focusable', () => {
    const el = mount('<button disabled>a</button>');
    const e = tabEvent();
    trapFocus(el, e);
    expect(e.defaultPrevented).toBe(true);
  });
});
