import { useEffect, useState } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import io, { Socket } from 'socket.io-client';
import LandingPage from './LandingPage';
import RoomPage from './RoomPage';
import { SocketContext } from './socketContext';

function App() {
  const navigate = useNavigate();
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const newSocket = io(window.location.origin);
    setSocket(newSocket);
    return () => {
      newSocket.disconnect();
    };
  }, []);

  return (
    <SocketContext.Provider value={{ socket, navigate }}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/room/:roomId" element={<RoomPage />} />
      </Routes>
    </SocketContext.Provider>
  );
}

export default App;