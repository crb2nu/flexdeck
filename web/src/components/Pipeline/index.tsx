import { Component, createSignal, onMount, For, Show } from 'solid-js';
import CIPipelineViz, { Pipeline as VizPipeline, PipelineStage } from './CIPipelineViz';
import { ciApi, RepoInfo } from '../../lib/api';

const Pipeline: Component = () => {
  const [repos, setRepos] = createSignal<RepoInfo[]>([]);
  const [selectedRepo, setSelectedRepo] = createSignal<RepoInfo | null>(null);
  const [pipelineData, setPipelineData] = createSignal<VizPipeline | undefined>(undefined);
  const [loading, setLoading] = createSignal(true);

  onMount(async () => {
    try {
      const data = await ciApi.listRepos();
      setRepos(data);
      if (data.length > 0) selectRepo(data[0]);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  });

  const selectRepo = (repo: RepoInfo) => {
    setSelectedRepo(repo);
    if (repo.hasConfig && repo.configContent) {
        setPipelineData(parseGitLabCi(repo.configContent, repo.name));
    } else {
        setPipelineData(undefined);
    }
  };

  const parseGitLabCi = (content: string, repoName: string): VizPipeline => {
      // Basic stage extraction
      const stagesMatch = content.match(/stages:\s*([\s\S]*?)(?:\n\S|$)/);
      let stages: string[] = [];
      if (stagesMatch) {
          const stagesBlock = stagesMatch[1];
          stages = stagesBlock.split('\n')
            .map(l => l.trim())
            .filter(l => l.startsWith('-'))
            .map(l => l.replace(/^-\s*/, '').trim());
      } 
      
      if (stages.length === 0) {
          stages = ['build', 'test', 'deploy']; // Default fallback
      }

      // Initialize stages
      const pipelineStages: PipelineStage[] = stages.map(name => ({
          name,
          jobs: []
      }));

      // Hacky job extraction
      // Looking for top level keys that have "script" or "stage"
      const lines = content.split('\n');
      let currentJob: { name: string, stage?: string } | null = null;

      // Identify job names (lines starting with non-space and ending with :)
      // This logic is fragile but suffices for a demo visualization of simple yamls
      for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const trimmed = line.trim();
          
          if (!trimmed || trimmed.startsWith('#')) continue;

          // Start of a job block?
          if (!line.startsWith(' ') && line.trim().endsWith(':')) {
              const name = line.split(':')[0].trim();
              if (['stages', 'variables', 'services', 'image', 'before_script', 'after_script', 'cache', 'include'].includes(name)) {
                  currentJob = null;
                  continue;
              }
              currentJob = { name };
          } 
          
          // Inside a job block, look for stage
          if (currentJob && trimmed.startsWith('stage:')) {
             currentJob.stage = trimmed.split(':')[1].trim();
             
             // Add job to stage
             const s = pipelineStages.find(st => st.name === currentJob!.stage);
             if (s && !s.jobs.find(j => j.name === currentJob!.name)) {
                 s.jobs.push({
                     id: `job-${currentJob.name}`,
                     name: currentJob.name,
                     stage: currentJob.stage!,
                     status: 'pending' 
                 });
             }
          }
      }
      
      // Auto-populate some fake jobs if parsing failed to extract any, just to show something
      if (pipelineStages.every(s => s.jobs.length === 0)) {
           pipelineStages.forEach((s, i) => {
               s.jobs.push({
                   id: `job-${s.name}-${i}`,
                   name: `${s.name}-job`,
                   stage: s.name,
                   status: 'pending'
               });
           });
      }

      return {
          id: `pipeline-${repoName}`,
          ref: 'main',
          status: 'pending',
          createdAt: new Date().toISOString(),
          stages: pipelineStages.filter(s => s.jobs.length > 0)
      };
  };

  return (
    <div class="flex h-full w-full">
        {/* Sidebar */}
        <div class="w-64 border-r border-white/10 bg-black/20 overflow-y-auto flex flex-col">
            <div class="p-4 border-b border-white/5">
                <h2 class="text-xs font-bold uppercase tracking-wider text-text-muted">Repositories</h2>
            </div>
            <div class="flex-1 p-2 flex flex-col gap-1">
                <Show when={loading()}>
                    <div class="px-3 py-2 text-xs text-text-dim">Loading...</div>
                </Show>
                <For each={repos()}>
                    {(repo) => (
                        <button
                            class={`text-left px-3 py-2 rounded text-sm font-medium transition-colors group relative ${
                                selectedRepo()?.path === repo.path 
                                    ? 'bg-neon-cyan/20 text-neon-cyan' 
                                    : 'text-text-dim hover:bg-white/5'
                            }`}
                            onClick={() => selectRepo(repo)}
                        >
                            <div class="truncate">{repo.name}</div>
                            <div class="text-[10px] opacity-50 font-mono mt-0.5 flex items-center justify-between">
                                <span>{repo.type}</span>
                                <Show when={repo.hasConfig}>
                                    <span class="w-1.5 h-1.5 rounded-full bg-neon-green" title="Config found"></span>
                                </Show>
                            </div>
                        </button>
                    )}
                </For>
            </div>
        </div>
        
        {/* Main Content */}
        <div class="flex-1 p-4 overflow-hidden relative bg-[#050a14]">
            <Show when={selectedRepo()} fallback={
                <div class="flex h-full items-center justify-center text-text-muted flex-col gap-2">
                    <div class="text-xl">Select a repository</div>
                    <div class="text-sm opacity-50">View CI pipelines for your local workspaces</div>
                </div>
            }>
                <Show when={pipelineData()} fallback={
                    <div class="flex h-full items-center justify-center text-text-muted flex-col gap-2">
                        <div class="text-xl">No CI Configuration</div>
                        <div class="text-sm opacity-50">
                            {selectedRepo()?.name} does not have a .gitlab-ci.yml file.
                        </div>
                    </div>
                }>
                    <CIPipelineViz pipeline={pipelineData()} />
                </Show>
            </Show>
        </div>
    </div>
  );
};

export default Pipeline;
