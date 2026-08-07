import type { AgentHandler } from './types.js';

export class AgentRegistry {
  private handlers = new Map<string, AgentHandler>();

  register(h: AgentHandler): void {
    if (this.handlers.has(h.id)) {
      throw new Error(`Agent handler already registered: ${h.id}`);
    }
    this.handlers.set(h.id, h);
  }

  get(id: string): AgentHandler {
    const handler = this.handlers.get(id);
    if (!handler) {
      throw new Error(`Agent handler not found: ${id}`);
    }
    return handler;
  }

  list(): AgentHandler[] {
    return Array.from(this.handlers.values());
  }
}
