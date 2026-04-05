import type { Component, ParentProps } from 'solid-js';

type PageScrollBodyProps = ParentProps<{
  class?: string;
  contentClass?: string;
  viewportRef?: (element: HTMLDivElement) => void;
}>;

const PageScrollBody: Component<PageScrollBodyProps> = (props) => (
  <div
    ref={(element) => props.viewportRef?.(element)}
    class={`h-full min-h-0 overflow-y-auto overscroll-contain ${props.class ?? ''}`}
  >
    <div class={`flex min-h-full min-w-0 flex-col ${props.contentClass ?? ''}`}>{props.children}</div>
  </div>
);

export default PageScrollBody;
