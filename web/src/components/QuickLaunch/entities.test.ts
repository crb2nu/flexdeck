import { describe, expect, it } from 'vitest';
import { buildEntityCommands } from './entities';

const ok = <T,>(value: T) => () => Promise.resolve(value);
const fail = () => Promise.reject(new Error('backend down'));

describe('buildEntityCommands', () => {
  it('builds deep-link commands for repos, workloads, and models', async () => {
    const commands = await buildEntityCommands({
      repos: ok({ repositories: [{ name: 'flexdeck', bucket: 'services', primaryLanguage: 'go' }] }),
      services: ok({ items: [{ metadata: { name: 'redis', namespace: 'flexdeck' } }] }),
      deployments: ok({ items: [{ metadata: { name: 'flexdeck', namespace: 'flexdeck' } }] }),
      models: ok({ models: [{ name: 'qwen3-14b', namespace: 'ai', status: { phase: 'Ready' } }] }),
    });

    const byId = new Map(commands.map((c) => [c.id, c]));
    expect(byId.get('repo:services/flexdeck')?.href).toBe('/stack?q=flexdeck');
    expect(byId.get('svc:flexdeck/redis')?.href).toBe('/services?tab=services&q=redis');
    expect(byId.get('deploy:flexdeck/flexdeck')?.href).toBe('/services?tab=deployments&q=flexdeck');
    expect(byId.get('model:ai/qwen3-14b')?.href).toBe('/flexinfer?section=telemetry&q=qwen3-14b');
    expect(byId.get('model:ai/qwen3-14b')?.description).toContain('Ready');
  });

  it('is best-effort per source: one failing backend does not drop the rest', async () => {
    const commands = await buildEntityCommands({
      repos: fail,
      services: fail,
      deployments: ok({ items: [{ metadata: { name: 'web', namespace: 'default' } }] }),
      models: ok({ models: [] }),
    });
    expect(commands).toHaveLength(1);
    expect(commands[0].section).toBe('Workloads');
  });

  it('skips unnamed items and URL-encodes names', async () => {
    const commands = await buildEntityCommands({
      repos: ok({ repositories: [] }),
      services: ok({ items: [{ metadata: {} }] }),
      deployments: ok({ items: [] }),
      models: ok({ models: [{ name: 'a b', namespace: 'x' }] }),
    });
    expect(commands).toHaveLength(1);
    expect(commands[0].href).toBe('/flexinfer?section=telemetry&q=a%20b');
  });
});
