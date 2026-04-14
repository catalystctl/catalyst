import { create } from 'zustand';
import { WebSocketManager } from '../services/websocket/WebSocketManager';
import type { WebSocketMessage } from '../services/websocket/types';

type MessageHandler = (message: WebSocketMessage) => void;

interface WebSocketState {
  isConnected: boolean;
  connect: () => void;
  reconnect: () => void;
  subscribe: (serverId: string) => void;
  unsubscribe: (serverId: string) => void;
  sendCommand: (serverId: string, command: string) => void;
  onMessage: (handler: MessageHandler) => () => void;
}

const manager = new WebSocketManager();

// Internal mutable state — NOT part of the zustand store so that
// subscribe/unsubscribe/onMessage don't trigger synchronous React
// re-renders when called inside useEffect. Only `isConnected` is
// reactive because components actually render based on it.
const internalSubscriptions = new Set<string>();
const internalHandlers = new Set<MessageHandler>();

export const useWebSocketStore = create<WebSocketState>((set, get) => ({
  isConnected: false,
  connect: () => {
    manager.connect({
      onOpen: () => set({ isConnected: true }),
      onClose: () => set({ isConnected: false }),
      onMessage: (message) => {
        internalHandlers.forEach((handler) => handler(message));
      },
    });
  },
  reconnect: () => {
    manager.reconnect({
      onOpen: () => set({ isConnected: true }),
      onClose: () => set({ isConnected: false }),
      onMessage: (message) => {
        internalHandlers.forEach((handler) => handler(message));
      },
    });
  },
  subscribe: (serverId) => {
    manager.subscribe(serverId);
    internalSubscriptions.add(serverId);
  },
  unsubscribe: (serverId) => {
    manager.unsubscribe(serverId);
    internalSubscriptions.delete(serverId);
  },
  sendCommand: (serverId, command) => manager.sendCommand(serverId, command),
  onMessage: (handler) => {
    internalHandlers.add(handler);
    return () => {
      internalHandlers.delete(handler);
    };
  },
}));
