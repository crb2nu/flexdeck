import type { Component, ParentProps } from 'solid-js';

type PageScrollBodyProps = ParentProps<{
  class?: string;
  contentClass?: string;
}>;

const PageScrollBody: Component<PageScrollBodyProps> = (props) => (
  <div class={`flex-1 min-h-0 overflow-y-auto ${props.class ?? ''}`}>
    <div class={`flex min-h-full flex-col ${props.contentClass ?? ''}`}>{props.children}</div>
  </div>
);

export default PageScrollBody;
