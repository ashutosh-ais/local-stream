import { createContext } from 'react';

export interface SocketContextType {
  socket: ReturnType<typeof import('socket.io-client').io> | null;
  navigate: any;
}

export const SocketContext = createContext<SocketContextType>({
  socket: null,
  navigate: () => {},
});