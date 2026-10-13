const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// In-memory store for rooms
const rooms = new Map();

// Multer setup for file uploads
const upload = multer({
  dest: 'uploads/', // We'll organize by roomId later
  limits: {
    fileSize: 10 * 1024 * 1024 * 1024 // 10GB limit
  }
});

// Generate a room ID (we'll use uuidv4 and take a short version)
function generateRoomId() {
  return uuidv4().substring(0, 6); // 6-character ID
}

// Create a new room
app.post('/api/rooms', (req, res) => {
  const roomId = generateRoomId();
  const hostToken = uuidv4(); // Generate a token for the host

  rooms.set(roomId, {
    hostToken,
    hostSocketId: null,
    participants: new Set(),
    videoUrl: null,
    isPlaying: false,
    currentTime: 0,
    // We'll store the video file path later
    videoFilePath: null
  });

  res.json({ roomId, hostToken });
});

// Upload video endpoint
app.post('/api/rooms/:roomId/upload', (req, res, next) => {
  upload.single('video')(req, res, (err) => {
    if (err) {
      console.error('Upload error:', err);
      return res.status(400).json({ error: err.message || 'File upload error' });
    }
    next();
  });
}, (req, res) => {
  const { roomId } = req.params;
  const hostToken = req.headers['x-host-token'];

  if (!rooms.has(roomId)) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const room = rooms.get(roomId);
  if (room.hostToken !== hostToken) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  // Create a directory for the room if it doesn't exist
  const roomUploadDir = path.join(__dirname, 'uploads', roomId);
  if (!fs.existsSync(roomUploadDir)) {
    fs.mkdirSync(roomUploadDir, { recursive: true });
  }

  // Generate a unique filename for the video to avoid conflicts
  const videoFilename = `video_${Date.now()}${path.extname(req.file.originalname)}`;
  const videoPath = path.join(roomUploadDir, videoFilename);

  // Move the file to the room's directory
  fs.renameSync(req.file.path, videoPath);

  // Update room state
  room.videoFilePath = videoPath;
  room.videoUrl = `/uploads/${roomId}/${videoFilename}`;

  // Broadcast updated room state to all clients in the room
  io.to(roomId).emit('stateUpdate', {
    videoUrl: room.videoUrl,
    isPlaying: room.isPlaying,
    currentTime: room.currentTime
  });

  res.json({ videoUrl: room.videoUrl });
});

// Serve uploaded videos
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/room/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'room.html'));
});

app.get('/api/rooms/list', (req, res) => {
  const uploadsDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    res.json([]);
    return;
  }
  const items = fs.readdirSync(uploadsDir, { withFileTypes: true });
  const rooms = [];
  for (const item of items) {
    if (item.isDirectory()) {
      const roomId = item.name;
      const roomDir = path.join(uploadsDir, roomId);
      let videoName = null;
      let videoTimestamp = null;
      try {
        const files = fs.readdirSync(roomDir);
        const videoFiles = files.filter(f => /\.(mp4|webm|ogg|mkv|mov|avi)$/i.test(f));
        if (videoFiles.length > 0) {
          // Sort by modification time to get the most recent
          videoFiles.sort((a, b) => {
            const statA = fs.statSync(path.join(roomDir, a));
            const statB = fs.statSync(path.join(roomDir, b));
            return statB.mtime - statA.mtime;
          });
          videoName = videoFiles[0];
          const stat = fs.statSync(path.join(roomDir, videoFiles[0]));
          videoTimestamp = stat.mtime;
        }
      } catch (e) {
        console.error(`Error scanning room ${roomId}:`, e);
      }
      rooms.push({
        roomId,
        videoName,
        videoTimestamp: videoTimestamp ? videoTimestamp.toISOString() : null
      });
    }
  }
  res.json(rooms);
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('joinRoom', ({ roomId, hostToken }) => {
    let room = rooms.get(roomId);
    if (!room) {
      // Try to load room from uploads folder
      const videoInfo = getRoomVideoInfo(roomId);
      if (!videoInfo) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }
      room = {
        hostToken: null,
          hostSocketId: null,
          participants: new Set(),
          videoUrl: videoInfo.videoUrl,
          videoFilePath: videoInfo.videoFile,
          isPlaying: false,
          currentTime: 0,
      };
      rooms.set(roomId, room);
    }

    // Check if there is an active host currently connected in this room
    const currentHostSocket = room.hostSocketId ? io.sockets.sockets.get(room.hostSocketId) : null;
    const isHostActive = currentHostSocket && currentHostSocket.connected && currentHostSocket.rooms && currentHostSocket.rooms.has(roomId);

    if (isHostActive && currentHostSocket.id === socket.id) {
      // The same socket is already the active host
      socket.emit('hostStatus', { isHost: true, hostToken: room.hostToken });
    } else if (isHostActive && currentHostSocket.id !== socket.id) {
      // An active host is already in the room! This new connection is a participant.
      room.participants.add(socket.id);
      socket.emit('hostStatus', { isHost: false });
    } else {
      // No active host in the room:
      // If client has matching hostToken, restore host; otherwise this first joiner becomes host!
      const newHostToken = (hostToken && room.hostToken && hostToken === room.hostToken) ? room.hostToken : (room.hostToken || uuidv4());
      room.hostToken = newHostToken;
      room.hostSocketId = socket.id;
      room.participants.delete(socket.id);
      socket.emit('hostStatus', { isHost: true, hostToken: newHostToken });
    }

    socket.join(roomId);

    // Send current state to the newly joined client
    socket.emit('stateUpdate', {
      videoUrl: room.videoUrl,
      isPlaying: room.isPlaying,
      currentTime: room.currentTime
    });

    // Notify others about the participant count
    io.to(roomId).emit('participantCount', {
      count: room.participants.size + (room.hostSocketId ? 1 : 0)
    });
  });

  socket.on('leaveRoom', ({ roomId }) => {
    if (!rooms.has(roomId)) return;

    const room = rooms.get(roomId);

    if (socket.id === room.hostSocketId) {
      if (room.participants.size > 0) {
        // Promote next participant to host
        const nextHostSocketId = room.participants.values().next().value;
        room.participants.delete(nextHostSocketId);
        room.hostSocketId = nextHostSocketId;
        const newHostToken = uuidv4();
        room.hostToken = newHostToken;
        io.to(nextHostSocketId).emit('hostStatus', { isHost: true, hostToken: newHostToken });
        io.to(roomId).emit('participantCount', {
          count: room.participants.size + 1
        });
      } else {
        room.hostSocketId = null;
        room.hostToken = null;
        const videoInfo = getRoomVideoInfo(roomId);
        if (!videoInfo) {
          rooms.delete(roomId);
        }
      }
    } else {
      room.participants.delete(socket.id);
      io.to(roomId).emit('participantCount', {
        count: room.participants.size + (room.hostSocketId ? 1 : 0)
      });
    }

    socket.leave(roomId);
  });

  socket.on('playVideo', ({ roomId, currentTime }) => {
    if (!rooms.has(roomId)) return;

    const room = rooms.get(roomId);
    if (socket.id !== room.hostSocketId) return; // Only host can control

    room.isPlaying = true;
    if (typeof currentTime === 'number') {
      room.currentTime = currentTime;
    }
    io.to(roomId).emit('playVideo', { currentTime: room.currentTime });
  });

  socket.on('pauseVideo', ({ roomId, currentTime }) => {
    if (!rooms.has(roomId)) return;

    const room = rooms.get(roomId);
    if (socket.id !== room.hostSocketId) return;

    room.isPlaying = false;
    if (typeof currentTime === 'number') {
      room.currentTime = currentTime;
    }
    io.to(roomId).emit('pauseVideo', { currentTime: room.currentTime });
  });

  socket.on('seekVideo', ({ roomId, currentTime }) => {
    if (!rooms.has(roomId)) return;

    const room = rooms.get(roomId);
    if (socket.id !== room.hostSocketId) return;

    room.currentTime = currentTime;
    io.to(roomId).emit('seekVideo', { currentTime });
  });

  // Periodic time update from host (optional, for better sync)
  socket.on('timeUpdate', ({ roomId, currentTime }) => {
    if (!rooms.has(roomId)) return;

    const room = rooms.get(roomId);
    if (socket.id !== room.hostSocketId) return;

    room.currentTime = currentTime;
    // We don't broadcast every time update to avoid too many messages
    // Instead, we rely on seek events and occasional updates
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);

    // Find which room the user was in and remove them
    for (const [roomId, room] of rooms.entries()) {
      if (socket.id === room.hostSocketId) {
        if (room.participants.size > 0) {
          // Promote next participant to host
          const nextHostSocketId = room.participants.values().next().value;
          room.participants.delete(nextHostSocketId);
          room.hostSocketId = nextHostSocketId;
          const newHostToken = uuidv4();
          room.hostToken = newHostToken;
          io.to(nextHostSocketId).emit('hostStatus', { isHost: true, hostToken: newHostToken });
          io.to(roomId).emit('participantCount', {
            count: room.participants.size + 1
          });
        } else {
          room.hostSocketId = null;
          room.hostToken = null;
          const videoInfo = getRoomVideoInfo(roomId);
          if (!videoInfo) {
            rooms.delete(roomId);
          }
        }
        break;
      } else if (room.participants.has(socket.id)) {
        room.participants.delete(socket.id);
        io.to(roomId).emit('participantCount', {
          count: room.participants.size + (room.hostSocketId ? 1 : 0)
        });
        break;
      }
    }
  });
});

function getRoomVideoInfo(roomId) {
  const roomDir = path.join(__dirname, 'uploads', roomId);
  if (!fs.existsSync(roomDir)) {
    return null;
  }
  try {
    const files = fs.readdirSync(roomDir);
    const videoFiles = files.filter(f => /\.(mp4|webm|ogg|mkv|mov|avi)$/i.test(f));
    if (videoFiles.length === 0) {
      return null;
    }
    // Sort by modification time to get the most recent
    videoFiles.sort((a, b) => {
      const statA = fs.statSync(path.join(roomDir, a));
      const statB = fs.statSync(path.join(roomDir, b));
      return statB.mtime - statA.mtime;
    });
    const videoFile = path.join(roomDir, videoFiles[0]);
    const videoUrl = `/uploads/${roomId}/${videoFiles[0]}`;
    return { videoFile, videoUrl };
  } catch (e) {
    console.error(`Error scanning room ${roomId}:`, e);
    return null;
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
