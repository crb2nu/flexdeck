/* @vitest-environment jsdom */

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';
import Input from './Input';
import Select from './Select';

describe('Input label wiring', () => {
  let container: HTMLDivElement;
  let dispose: () => void;

  afterEach(() => {
    dispose?.();
    container?.remove();
  });

  function mount(el: () => import('solid-js').JSX.Element) {
    container = document.createElement('div');
    document.body.appendChild(container);
    dispose = render(el, container);
  }

  it('associates the label with the input via for/id', () => {
    mount(() => <Input label="Search" value="" />);
    const label = container.querySelector('label');
    const input = container.querySelector('input');
    expect(label?.textContent).toBe('Search');
    expect(input?.id).toBeTruthy();
    expect(label?.getAttribute('for')).toBe(input?.id);
  });

  it('respects an explicit id over the generated one', () => {
    mount(() => <Input label="Name" id="custom-id" value="" />);
    expect(container.querySelector('input')?.id).toBe('custom-id');
    expect(container.querySelector('label')?.getAttribute('for')).toBe('custom-id');
  });

  it('renders no label element and no id when label is omitted', () => {
    mount(() => <Input value="" placeholder="query" />);
    expect(container.querySelector('label')).toBeNull();
    expect(container.querySelector('input')?.hasAttribute('id')).toBe(false);
  });

  it('associates Select label via for/id and renders options', () => {
    mount(() => (
      <Select
        label="Namespace"
        options={[{ value: 'a', label: 'A' }]}
        placeholder="All"
      />
    ));
    const label = container.querySelector('label');
    const select = container.querySelector('select');
    expect(label?.getAttribute('for')).toBe(select?.id);
    expect(select?.querySelectorAll('option').length).toBe(2);
  });
});
