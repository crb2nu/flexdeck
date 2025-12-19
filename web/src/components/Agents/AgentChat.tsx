import { Component, createSignal, createEffect, onMount, onCleanup, For, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { Agent } from '../../lib/types';
import { agentsApi } from '../../lib/api';
import ChartWidget from './Widgets/ChartWidget';
import StatusWidget from './Widgets/StatusWidget';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  thinking?: boolean;
  widgets?: {
    type: 'chart' | 'status' | 'code' | 'agent-config';
    data: any;
  }[];
  metadata?: {
    iterations?: number;
    approved?: boolean;
    totalTokens?: number;
    latencyMs?: number;
  };
}

interface AgentChatProps {
  agent: Agent;
  onClose: () => void;
}

const AgentChat: Component<AgentChatProps> = (props) => {
  const [messages, setMessages] = createStore<Message[]>([
    {
      role: 'assistant',
      content: `**Neural Link established** with **${props.agent.name}**.\n\n${getWelcomeMessage(props.agent)}`,
      timestamp: Date.now(),
    }
  ]);
  const [input, setInput] = createSignal('');
  const [isTyping, setIsTyping] = createSignal(false);
  const [connectionStatus, setConnectionStatus] = createSignal<'connected' | 'error' | 'idle'>('connected');
  let messagesEndRef: HTMLDivElement | undefined;
  let inputRef: HTMLTextAreaElement | undefined;

  function getWelcomeMessage(agent: Agent): string {
    if (agent.id === 'agent-builder' || agent.metadata?.spec_decode) {
      return `I'm the **Agent Builder** - your AI assistant for designing and configuring agents.\n\nI use speculative decoding with local models for fast, high-quality responses.\n\nTry asking me to:\n- Design an agent for a specific task\n- Explain how to set up RAG with Qdrant\n- Configure speculative decoding\n- List available models`;
    }
    return `Ready to process commands. Type your query below.`;
  }

  const scrollToBottom = () => {
    messagesEndRef?.scrollIntoView({ behavior: 'smooth' });
  };

  createEffect(() => {
    messages.length;
    scrollToBottom();
  });

  onMount(() => {
    inputRef?.focus();
    
    // Handle ESC key
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', handleEsc);
    onCleanup(() => window.removeEventListener('keydown', handleEsc));
  });

  const handleSend = async () => {
    if (!input().trim() || isTyping()) return;

    const userMsg = input();
    setInput('');
    
    // Add user message
    setMessages(messages.length, {
      role: 'user',
      content: userMsg,
      timestamp: Date.now()
    });

    setIsTyping(true);

    try {
      // Check if this is the built-in Agent Builder
      const isAgentBuilder = props.agent.id === 'agent-builder' || 
                             props.agent.metadata?.spec_decode ||
                             props.agent.url?.includes('agent-builder');

      let responseContent: string;
      let widgets: Message['widgets'] = undefined;
      let metadata: Message['metadata'] = undefined;

      if (isAgentBuilder) {
        // Call the Agent Builder endpoint
        const response = await fetch('/api/agents/builder/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: userMsg })
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Agent Builder request failed');
        }

        const result = await response.json();
        responseContent = result.response || 'No response received';
        
        metadata = {
          iterations: result.metadata?.iterations,
          approved: result.metadata?.approved,
          totalTokens: result.metadata?.total_tokens,
          latencyMs: result.metadata?.latency_ms
        };

        // If an agent config was extracted, show it
        if (result.agent_config) {
          widgets = [{
            type: 'agent-config',
            data: result.agent_config
          }];
        }

        setConnectionStatus('connected');
      } else {
        // Regular agent invocation
        try {
          const result = await agentsApi.invoke(props.agent.id, { input: { message: userMsg } });
          responseContent = result.output?.message || result.output?.response || JSON.stringify(result.output);
          
          metadata = { latencyMs: result.latency_ms };
          setConnectionStatus('connected');
        } catch (e) {
          // Fallback to demo response
          responseContent = generateDemoResponse(userMsg, props.agent);
          setConnectionStatus('idle');
        }
      }

      // Parse for widget hints in response
      if (!widgets) {
        widgets = parseWidgetsFromResponse(responseContent, userMsg);
      }

      setMessages(messages.length, {
        role: 'assistant',
        content: responseContent,
        timestamp: Date.now(),
        widgets: widgets,
        metadata: metadata
      });

    } catch (err) {
      setConnectionStatus('error');
      setMessages(messages.length, {
        role: 'system',
        content: `**Error:** ${err instanceof Error ? err.message : 'Connection interrupted'}\n\nCheck that LiteLLM is configured and running.`,
        timestamp: Date.now()
      });
    } finally {
      setIsTyping(false);
    }
  };

  function generateDemoResponse(query: string, agent: Agent): string {
    const lowerQuery = query.toLowerCase();
    
    if (lowerQuery.includes('status')) {
      return "System diagnostics complete. All core subsystems are operating within normal parameters.";
    }
    if (lowerQuery.includes('help')) {
      return `**${agent.name}** capabilities:\n\n- Ask about system status\n- Request metrics or charts\n- Query cluster information\n- Design new agents`;
    }
    return `I received your query: "${query}"\n\nThis is a demo response. Connect a real backend agent for live functionality.`;
  }

  function parseWidgetsFromResponse(response: string, query: string): Message['widgets'] {
    const lowerQuery = query.toLowerCase();
    
    if (lowerQuery.includes('status') || response.toLowerCase().includes('healthy')) {
      return [{
        type: 'status',
        data: { 
          status: 'healthy', 
          message: 'System Operational',
          metrics: { cpu: '45%', ram: '2.4GB', pods: '12/12' } 
        }
      }];
    }
    
    if (lowerQuery.includes('chart') || lowerQuery.includes('metric') || lowerQuery.includes('traffic')) {
      return [{
        type: 'chart',
        data: {
          title: 'Ingress Traffic (Req/s)',
          type: 'bar',
          labels: ['10:00', '10:10', '10:20', '10:30', '10:40', '10:50'],
          datasets: [
            { label: 'HTTP', data: [120, 150, 180, 140, 200, 250], color: '#00d9ff' },
            { label: 'gRPC', data: [50, 60, 40, 80, 90, 100], color: '#a855f7' }
          ]
        }
      }];
    }
    
    return undefined;
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatMarkdown = (text: string) => {
    // Simple markdown-like formatting
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong class="text-neon-cyan">$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code class="bg-white/10 px-1 rounded text-neon-purple">$1</code>')
      .replace(/\n/g, '<br/>');
  };

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md animate-fade-in-scale">
      <div class="flex h-[90vh] w-[95vw] max-w-5xl flex-col overflow-hidden rounded-xl border border-neon-cyan/30 bg-[#060a14] shadow-[0_0_60px_rgba(0,217,255,0.15)]">
        
        {/* Header */}
        <div class="flex items-center justify-between border-b border-neon-cyan/20 bg-[#030508]/95 px-6 py-4 backdrop-blur-sm">
            <div class="flex items-center gap-4">
                <div class="relative flex h-12 w-12 items-center justify-center rounded-lg border border-neon-cyan/50 bg-neon-cyan/10">
                    <span class="text-2xl">{props.agent.metadata?.spec_decode ? '⚡' : '🤖'}</span>
                    <div class={`absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-[#060a14] ${
                      connectionStatus() === 'connected' ? 'bg-status-success' : 
                      connectionStatus() === 'error' ? 'bg-status-error' : 'bg-status-warning'
                    }`}></div>
                </div>
                <div>
                    <h3 class="font-bold text-neon-cyan text-lg tracking-wide">{props.agent.name}</h3>
                    <div class="flex items-center gap-3 text-xs text-neon-cyan/60 font-mono">
                        <span class="flex items-center gap-1.5">
                          <span class="relative flex h-2 w-2">
                            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-neon-cyan opacity-75"></span>
                            <span class="relative inline-flex rounded-full h-2 w-2 bg-neon-cyan"></span>
                          </span>
                          NEURAL LINK ACTIVE
                        </span>
                        {props.agent.metadata?.spec_decode && (
                          <span class="px-2 py-0.5 rounded bg-neon-purple/20 text-neon-purple border border-neon-purple/30">
                            SPEC-DECODE
                          </span>
                        )}
                    </div>
                </div>
            </div>
            <button 
                onClick={props.onClose}
                class="rounded-lg px-3 py-2 text-sm text-neon-cyan/50 hover:bg-neon-cyan/10 hover:text-neon-cyan transition-colors font-mono"
            >
                ESC ✕
            </button>
        </div>

        {/* Chat Area */}
        <div class="flex-1 overflow-y-auto p-6 space-y-6 font-mono text-sm bg-gradient-to-b from-transparent to-[#030508]/50">
            <For each={messages}>
                {(msg) => (
                    <div class={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div class={`max-w-[85%] rounded-lg p-4 ${
                            msg.role === 'user' 
                                ? 'bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan shadow-[0_0_20px_rgba(0,217,255,0.1)]' 
                                : msg.role === 'system'
                                ? 'bg-status-error/10 border border-status-error/30 text-status-error'
                                : 'bg-[#0c1220] border border-white/10 text-text-main shadow-lg'
                        }`}>
                            <div 
                              class="whitespace-pre-wrap leading-relaxed" 
                              innerHTML={formatMarkdown(msg.content)}
                            />
                            
                            {/* Metadata (for spec-decode) */}
                            <Show when={msg.metadata && msg.role === 'assistant'}>
                                <div class="mt-3 pt-2 border-t border-white/5 flex items-center gap-3 text-[10px] text-text-dim">
                                    <Show when={msg.metadata?.iterations}>
                                        <span>🔄 {msg.metadata?.iterations} iterations</span>
                                    </Show>
                                    <Show when={msg.metadata?.approved !== undefined}>
                                        <span class={msg.metadata?.approved ? 'text-status-success' : 'text-status-warning'}>
                                            {msg.metadata?.approved ? '✓ Approved' : '⚠ Max iterations'}
                                        </span>
                                    </Show>
                                    <Show when={msg.metadata?.totalTokens}>
                                        <span>📊 {msg.metadata?.totalTokens} tokens</span>
                                    </Show>
                                    <Show when={msg.metadata?.latencyMs}>
                                        <span>⚡ {msg.metadata?.latencyMs}ms</span>
                                    </Show>
                                </div>
                            </Show>
                            
                            {/* Generative UI Widgets */}
                            <Show when={msg.widgets}>
                                <div class="mt-4 border-t border-white/10 pt-3 space-y-3">
                                    <div class="text-[10px] text-text-dim uppercase tracking-wider mb-2 flex items-center gap-2">
                                        <div class="h-px flex-1 bg-gradient-to-r from-neon-cyan/30 to-transparent"></div>
                                        Generated Interface
                                        <div class="h-px flex-1 bg-gradient-to-l from-neon-cyan/30 to-transparent"></div>
                                    </div>
                                    <For each={msg.widgets}>
                                        {(widget) => (
                                            <>
                                              <Show when={widget.type === 'chart'}>
                                                  <ChartWidget data={widget.data} />
                                              </Show>
                                              <Show when={widget.type === 'status'}>
                                                  <StatusWidget data={widget.data} />
                                              </Show>
                                              <Show when={widget.type === 'agent-config'}>
                                                  <div class="bg-black/40 border border-neon-purple/30 rounded-lg p-3">
                                                      <div class="text-neon-purple text-xs mb-2 font-bold">AGENT CONFIGURATION</div>
                                                      <pre class="text-[11px] text-text-main overflow-x-auto">{JSON.stringify(widget.data, null, 2)}</pre>
                                                  </div>
                                              </Show>
                                            </>
                                        )}
                                    </For>
                                </div>
                            </Show>

                            <div class="mt-2 text-[10px] opacity-40 text-right">
                                {new Date(msg.timestamp).toLocaleTimeString()}
                            </div>
                        </div>
                    </div>
                )}
            </For>
            
            <Show when={isTyping()}>
                <div class="flex justify-start">
                    <div class="bg-[#0c1220] border border-white/10 rounded-lg p-4 flex items-center gap-3">
                        <div class="flex items-center gap-1">
                            <div class="w-2 h-2 bg-neon-cyan rounded-full animate-bounce" style={{"animation-delay": "0ms"}}></div>
                            <div class="w-2 h-2 bg-neon-cyan rounded-full animate-bounce" style={{"animation-delay": "150ms"}}></div>
                            <div class="w-2 h-2 bg-neon-cyan rounded-full animate-bounce" style={{"animation-delay": "300ms"}}></div>
                        </div>
                        <span class="text-xs text-text-dim">Processing with speculative decode...</span>
                    </div>
                </div>
            </Show>
            
            <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div class="border-t border-white/10 bg-[#030508] p-4">
            <div class="relative flex items-end gap-2 rounded-xl border border-white/10 bg-white/5 p-2 focus-within:border-neon-cyan/50 focus-within:shadow-[0_0_30px_rgba(0,217,255,0.1)] transition-all">
                <textarea
                    ref={inputRef}
                    value={input()}
                    onInput={(e) => setInput(e.currentTarget.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Transmit command..."
                    rows={1}
                    class="max-h-32 min-h-[2.5rem] w-full resize-none bg-transparent px-3 py-2 text-text-main placeholder-text-dim/50 focus:outline-none font-mono"
                    style={{ "field-sizing": "content" } as any}
                />
                <button
                    onClick={handleSend}
                    disabled={!input().trim() || isTyping()}
                    class="mb-0.5 rounded-lg bg-neon-cyan/20 p-2.5 text-neon-cyan hover:bg-neon-cyan/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all group"
                >
                    <svg class="w-5 h-5 group-hover:translate-x-0.5 transition-transform" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                    </svg>
                </button>
            </div>
            <div class="mt-2 flex items-center justify-between text-[10px] text-text-dim px-1">
                <span>
                    <span class="text-neon-cyan">SHIFT + ENTER</span> for new line
                </span>
                <span class="opacity-60">
                    {props.agent.metadata?.spec_decode ? 'Speculative Decode • Draft→Verify→Revise' : props.agent.model || 'Standard Agent'}
                </span>
            </div>
        </div>
      </div>
    </div>
  );
};

export default AgentChat;
