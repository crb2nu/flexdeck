import { Component, createSignal, Show, onCleanup, For } from 'solid-js';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastProps {
  message: string;
  type: ToastType;
  onDismiss: () => void;
  duration?: number;
}

const Toast: Component<ToastProps> = (props) => {
  const [exiting, setExiting] = createSignal(false);

  const dismiss = () => {
    setExiting(true);
    setTimeout(() => props.onDismiss(), 200);
  };

  // Auto-dismiss after duration
  const timer = setTimeout(() => {
    dismiss();
  }, props.duration || 3000);

  onCleanup(() => clearTimeout(timer));

  const typeStyles: Record<ToastType, { bg: string; border: string; icon: string }> = {
    success: {
      bg: 'bg-neon-green/10',
      border: 'border-neon-green/30',
      icon: '✓',
    },
    error: {
      bg: 'bg-red-500/10',
      border: 'border-red-500/30',
      icon: '✕',
    },
    info: {
      bg: 'bg-neon-cyan/10',
      border: 'border-neon-cyan/30',
      icon: 'ℹ',
    },
  };

  const style = typeStyles[props.type];

  return (
    <div
      class={`flex items-center gap-3 px-4 py-3 rounded-lg border backdrop-blur-md shadow-lg transition-all duration-200 ${style.bg} ${style.border} ${
        exiting() ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0'
      }`}
      style={{
        animation: exiting() ? 'none' : 'slideInRight 0.2s ease-out',
      }}
    >
      <span class="text-sm font-mono">{style.icon}</span>
      <span class="text-sm text-text-main">{props.message}</span>
      <button
        onClick={dismiss}
        class="ml-2 text-text-dim hover:text-text-main transition-colors"
      >
        ✕
      </button>
    </div>
  );
};

// Toast container and hook for managing toasts
let toastId = 0;
const [toasts, setToasts] = createSignal<ToastMessage[]>([]);

export function showToast(message: string, type: ToastType = 'info') {
  const id = ++toastId;
  setToasts(prev => [...prev, { id, message, type }]);
}

export function dismissToast(id: number) {
  setToasts(prev => prev.filter(t => t.id !== id));
}

export const ToastContainer: Component = () => {
  return (
    <div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      <Show when={toasts().length > 0}>
        <For each={toasts()}>{toast => (
          <Toast
            message={toast.message}
            type={toast.type}
            onDismiss={() => dismissToast(toast.id)}
          />
        )}</For>
      </Show>
    </div>
  );
};

export default Toast;
