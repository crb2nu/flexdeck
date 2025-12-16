import { Component, createSignal, createEffect, onMount, onCleanup, For, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { Agent } from '../../lib/types';
import { agentsApi } from '../../lib/api';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  widgets?: {
    type: 'chart' | 'status' | 'code';
    data: any;
  }[];
}

interface AgentChatProps {
  agent: Agent;
  onClose: () => void;
}

const AgentChat: Component<AgentChatProps> = (props) => {
  const [messages, setMessages] = createStore<Message[]>([
    {
      role: 'assistant',
      content: `Neural Link established with **${props.agent.name}**. awaiting input...`,
      timestamp: Date.now(),
    }
  ]);
  const [input, setInput] = createSignal('');
  const [isTyping, setIsTyping] = createSignal(false);
  let messagesEndRef: HTMLDivElement | undefined;
  let inputRef: HTMLTextAreaElement | undefined;

  const scrollToBottom = () => {
    messagesEndRef?.scrollIntoView({ behavior: 'smooth' });
  };

  createEffect(() => {
    messages.length;
    scrollToBottom();
  });

  onMount(() => {
    inputRef?.focus();
  });

  const handleSend = async () => {
    if (!input().trim() || isTyping()) return;

    const userMsg = input();
    setInput('');
    
    // Add user message
    setMessages([...messages, {
      role: 'user',
      content: userMsg,
      timestamp: Date.now()
    }]);

    setIsTyping(true);

    try {
      // Simulate network delay for "thinking" effect if local
      // In real implementation this calls the actual agent API
      // const response = await agentsApi.test(props.agent.id, { message: userMsg }); 
      
      // MOCK RESPONSE for Tech Demo purposes (since backend implementation of chat might vary)
      // replace with actual API call:
      const result = await agentsApi.test(props.agent.id, { input: userMsg });
      
      const responseContent = typeof result.output === 'string' 
        ? result.output 
        : JSON.stringify(result.output, null, 2);

      setMessages([...messages, {
        role: 'assistant',
        content: responseContent,
        timestamp: Date.now(),
        // Mock widget generation based on keywords
        widgets: userMsg.toLowerCase().includes('status') ? [{
             type: 'status',
             data: { status: 'healthy', metrics: { cpu: '45%', ram: '2.4GB' } }
        }] : undefined
      }]);

    } catch (err) {
      setMessages([...messages, {
        role: 'system',
        content: `Error: ${err instanceof Error ? err.message : 'Connection interrupted'}`,
        timestamp: Date.now()
      }]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md animate-fade-in-scale">
      <div class="flex h-[85vh] w-[90vw] max-w-4xl flex-col overflow-hidden rounded-xl border border-neon-cyan/30 bg-[#0a1020] shadow-[0_0_50px_rgba(0,217,255,0.15)]">
        
        {/* Header */}
        <div class="flex items-center justify-between border-b border-neon-cyan/20 bg-[#050a14]/90 px-6 py-4 backdrop-blur">
            <div class="flex items-center gap-3">
                <div class="flex h-10 w-10 items-center justify-center rounded-full border border-neon-cyan/50 bg-neon-cyan/10">
                    <span class="text-xl">🤖</span>
                </div>
                <div>
                    <h3 class="font-bold text-neon-cyan text-lg tracking-wide">{props.agent.name}</h3>
                    <div class="flex items-center gap-2 text-xs text-neon-cyan/60 font-mono">
                        <span class="relative flex h-2 w-2">
                          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-neon-cyan opacity-75"></span>
                          <span class="relative inline-flex rounded-full h-2 w-2 bg-neon-cyan"></span>
                        </span>
                        NEURAL LINK ACTIVE
                    </div>
                </div>
            </div>
            <button 
                onClick={props.onClose}
                class="rounded-lg p-2 text-neon-cyan/50 hover:bg-neon-cyan/10 hover:text-neon-cyan transition-colors"
            >
                ✕ ESC
            </button>
        </div>

        {/* Chat Area */}
        <div class="flex-1 overflow-y-auto p-6 space-y-6 font-mono text-sm">
            <For each={messages}>
                {(msg) => (
                    <div class={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div class={`max-w-[80%] rounded-lg p-4 ${
                            msg.role === 'user' 
                                ? 'bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan shadow-[0_0_15px_rgba(0,217,255,0.1)]' 
                                : msg.role === 'system'
                                ? 'bg-status-error/10 border border-status-error/30 text-status-error'
                                : 'bg-[#0f172a] border border-white/10 text-text-main shadow-lg'
                        }`}>
                            <div class="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                            
                            {/* Generative UI Widgets (Mock) */}
                            <Show when={msg.widgets}>
                                <div class="mt-4 border-t border-white/10 pt-3">
                                    <div class="text-[10px] text-text-dim uppercase tracking-wider mb-2">Generated Widget</div>
                                    <div class="rounded bg-black/40 p-3 border border-neon-purple/30">
                                         {/* Placeholder for real widget rendering */}
                                         <div class="flex justify-between items-center text-neon-purple">
                                            <span>STATUS CHECK</span>
                                            <span>ALL SYSTEMS OPERATIONAL</span>
                                         </div>
                                    </div>
                                </div>
                            </Show>

                            <div class="mt-2 text-[10px] opacity-50 text-right">
                                {new Date(msg.timestamp).toLocaleTimeString()}
                            </div>
                        </div>
                    </div>
                )}
            </For>
            
            <Show when={isTyping()}>
                <div class="flex justify-start">
                    <div class="bg-[#0f172a] border border-white/10 rounded-lg p-4 flex items-center gap-2">
                        <div class="w-2 h-2 bg-neon-cyan rounded-full animate-bounce" style={{"animation-delay": "0ms"}}></div>
                        <div class="w-2 h-2 bg-neon-cyan rounded-full animate-bounce" style={{"animation-delay": "150ms"}}></div>
                        <div class="w-2 h-2 bg-neon-cyan rounded-full animate-bounce" style={{"animation-delay": "300ms"}}></div>
                    </div>
                </div>
            </Show>
            
            <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div class="border-t border-white/10 bg-[#050a14] p-4">
            <div class="relative flex items-end gap-2 rounded-xl border border-white/10 bg-white/5 p-2 focus-within:border-neon-cyan/50 focus-within:shadow-[0_0_20px_rgba(0,217,255,0.1)] transition-all">
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
                    class="mb-0.5 rounded-lg bg-neon-cyan/20 p-2 text-neon-cyan hover:bg-neon-cyan/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                    ➤
                </button>
            </div>
            <div class="mt-2 text-center text-[10px] text-text-dim">
                <span class="text-neon-cyan">SHIFT + ENTER</span> for new line. AI Agents may produce hallucinated metrics.
            </div>
        </div>
      </div>
    </div>
  );
};

export default AgentChat;
