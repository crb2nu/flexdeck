import { createStore } from 'solid-js/store';

interface Link {
  label: string;
  href: string;
  disabled?: boolean;
}

interface LaunchpadItem {
  label: string;
  href: string;
  icon?: string;
}

interface LaunchpadGroup {
  title: string;
  icon?: string;
  items: LaunchpadItem[];
}

interface UIConfigState {
  title: string;
  accent: string;
  links: Link[];
  launchpad: LaunchpadGroup[];
  loading: boolean;
  error: string | null;
}

const [uiConfigStore, setUIConfigStore] = createStore<UIConfigState>({
  title: 'FLEXDECK',
  accent: '#00f0ff',
  links: [],
  launchpad: [],
  loading: true,
  error: null,
});

async function fetchUIConfig(): Promise<void> {
  setUIConfigStore('loading', true);
  setUIConfigStore('error', null);

  try {
    const response = await fetch('/api/ui-config');
    if (!response.ok) {
      throw new Error(`UI config fetch failed: ${response.status}`);
    }

    const data = await response.json();
    setUIConfigStore({
      title: data.title || 'FLEXDECK',
      accent: data.accent || '#00f0ff',
      links: data.links || [],
      launchpad: data.launchpad || [],
      loading: false,
      error: null,
    });

    // Apply accent color to CSS variable
    if (data.accent) {
      document.documentElement.style.setProperty('--color-accent', data.accent);
    }
  } catch (err) {
    setUIConfigStore({
      loading: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}

export { uiConfigStore, fetchUIConfig };
