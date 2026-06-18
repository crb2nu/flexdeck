import { Component, ParentProps, Switch, Match, createSignal, onMount } from 'solid-js';
import { authStatus, checkAuth, login } from '../../stores/auth';

/**
 * LoginGate guards the routed content when RBAC enforcement is active. It probes
 * the auth state once on mount and renders:
 *  - a spinner while the probe is in flight ('unknown' | 'checking')
 *  - the token login screen when RBAC rejects the session ('required')
 *  - the wrapped content otherwise ('authed' | 'not-required')
 *
 * A 401 from any later API call flips authStatus back to 'required' (see
 * stores/auth notifyUnauthorized + api client), which re-renders the gate.
 */
const LoginGate: Component<ParentProps> = (props) => {
  onMount(() => {
    if (authStatus() === 'unknown') {
      void checkAuth();
    }
  });

  return (
    <Switch fallback={props.children}>
      <Match when={authStatus() === 'unknown' || authStatus() === 'checking'}>
        <AuthSpinner />
      </Match>
      <Match when={authStatus() === 'required'}>
        <LoginScreen />
      </Match>
    </Switch>
  );
};

const AuthSpinner: Component = () => (
  <div class="flex h-full w-full items-center justify-center">
    <div class="flex flex-col items-center gap-4">
      <div class="relative">
        <div class="h-10 w-10 rounded-full border-2 border-white/[0.06]" />
        <div class="absolute inset-0 h-10 w-10 animate-spin rounded-full border-2 border-transparent border-t-white/40" />
      </div>
      <div class="text-xs font-medium tracking-wide text-text-muted">Checking access</div>
    </div>
  </div>
);

const LoginScreen: Component = () => {
  const [tokenInput, setTokenInput] = createSignal('');
  const [error, setError] = createSignal<string | null>(null);
  const [submitting, setSubmitting] = createSignal(false);

  const submit = async (event: Event) => {
    event.preventDefault();
    const value = tokenInput().trim();
    if (!value || submitting()) return;

    setSubmitting(true);
    setError(null);
    try {
      const ok = await login(value);
      if (!ok) {
        setError('That token was not accepted. Check it and try again.');
      }
    } catch {
      setError('Could not reach the server. Try again in a moment.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div class="flex h-full w-full items-center justify-center p-4">
      <form
        onSubmit={submit}
        class="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-bg-dark/80 p-6 shadow-[0_8px_40px_rgba(0,0,0,0.45)] backdrop-blur"
      >
        <div class="mb-5 flex flex-col gap-1.5">
          <span class="text-sm font-semibold tracking-tight text-white">
            Flex<span class="text-text-dim">Deck</span>
          </span>
          <h1 class="text-lg font-semibold text-text-main">Sign in</h1>
          <p class="text-xs leading-relaxed text-text-muted">
            This dashboard requires access. Paste your access token to continue.
          </p>
        </div>

        <label class="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-text-dim" for="rbac-token">
          Access token
        </label>
        <input
          id="rbac-token"
          type="password"
          autocomplete="current-password"
          autofocus
          value={tokenInput()}
          onInput={(e) => setTokenInput(e.currentTarget.value)}
          placeholder="Paste token"
          disabled={submitting()}
          class="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-text-main outline-none transition-colors placeholder:text-text-dim focus:border-[#00c8ff]/50 focus:bg-white/[0.06] disabled:opacity-60"
        />

        <Switch>
          <Match when={error()}>
            <p class="mt-2 text-xs text-[#ff6b8f]">{error()}</p>
          </Match>
        </Switch>

        <button
          type="submit"
          disabled={submitting() || tokenInput().trim() === ''}
          class="mt-5 flex w-full items-center justify-center gap-2 rounded-lg border border-[#00c8ff]/30 bg-[#00c8ff]/10 px-4 py-2.5 text-sm font-medium text-white transition-all hover:bg-[#00c8ff]/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Switch fallback={<span>Continue</span>}>
            <Match when={submitting()}>
              <span class="h-4 w-4 animate-spin rounded-full border-2 border-transparent border-t-white/70" />
              <span>Verifying</span>
            </Match>
          </Switch>
        </button>
      </form>
    </div>
  );
};

export default LoginGate;
