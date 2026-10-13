// Global variables
let socket = null;
let roomId = null;
let hostToken = null;
let isHost = false;

// Check if we are on the room page by looking for the room ID in the URL
function init() {
    const path = window.location.pathname;
    if (path === '/' || path === '/index.html') {
        initLandingPage();
    } else if (path.startsWith('/room/')) {
        initRoomPage();
    } else {
        showError('Unknown page');
    }
}

function initLandingPage() {
    const createTab = document.getElementById('create-tab');
    const joinTab = document.getElementById('join-tab');
    const createSection = document.getElementById('create-section');
    const joinSection = document.getElementById('join-section');
    const createBtn = document.getElementById('create-btn');
    const joinBtn = document.getElementById('join-btn');
    const roomIdInput = document.getElementById('room-id-input');
    const createResult = document.getElementById('create-result');
    const joinResult = document.getElementById('join-result');

    createTab.addEventListener('click', () => {
        createTab.classList.add('active');
        joinTab.classList.remove('active');
        createSection.classList.add('active');
        joinSection.classList.remove('active');
    });

    joinTab.addEventListener('click', () => {
        joinTab.classList.add('active');
        createTab.classList.remove('active');
        joinSection.classList.add('active');
        createSection.classList.remove('active');
    });

    createBtn.addEventListener('click', async () => {
        createResult.textContent = 'Creating room...';
        try {
            const response = await fetch('/api/rooms', {
                method: 'POST'
            });
            if (!response.ok) throw new Error('Failed to create room');
            const data = await response.json();
            roomId = data.roomId;
            hostToken = data.hostToken;
            // Store hostToken in localStorage so we can use it after redirect
            localStorage.setItem(`hostToken_${roomId}`, hostToken);
            // Redirect to room page
            window.location.href = `/room/${roomId}`;
        } catch (error) {
            createResult.textContent = `Error: ${error.message}`;
            createResult.style.color = '#e74c3c';
        }
    });

    joinBtn.addEventListener('click', () => {
        const inputRoomId = roomIdInput.value.trim().toUpperCase();
        if (!inputRoomId) {
            joinResult.textContent = 'Please enter a room ID';
            joinResult.style.color = '#e74c3c';
            return;
        }
        joinResult.textContent = 'Joining room...';
        // We'll validate by trying to access the room page? Or we can check via an API?
        // For simplicity, we'll redirect and let the room page handle errors.
        window.location.href = `/room/${inputRoomId}`;
    });
}

function initRoomPage() {
    // Extract room ID from URL
    const pathParts = window.location.pathname.split('/');
    roomId = pathParts[2]; // /room/:roomId
    if (!roomId) {
        showError('Invalid room URL');
        return;
    }

    // Get hostToken from localStorage if we are the host
    hostToken = localStorage.getItem(`hostToken_${roomId}`);
    // If we have a hostToken, we consider ourselves the host (for now)
    isHost = !!hostToken;

    // Display room info
    document.getElementById('room-id-display').textContent = roomId;
    // We need to construct the room URL. We'll use window.location.origin for the base.
    const roomUrl = `${window.location.origin}/room/${roomId}`;
    document.getElementById('room-url').textContent = roomUrl;

    // Initialize Socket.io
    socket = io();

    // Register as host if we have a hostToken
    if (isHost) {
        socket.emit('joinRoom', { roomId, hostToken });
    } else {
        socket.emit('joinRoom', { roomId });
    }

    // Set up UI elements
    const videoPlayer = document.getElementById('video-player');
    const videoFileInput = document.getElementById('video-file-input');
    const uploadStatus = document.getElementById('upload-status');
    const playBtn = document.getElementById('play-btn');
    const pauseBtn = document.getElementById('pause-btn');
    const hostControls = document.getElementById('host-controls');
    const participantMessage = document.getElementById('participant-message');
    const participantCountDiv = document.getElementById('participant-count');
    const errorMessage = document.getElementById('error-message');

    // Show/hide host controls
    if (isHost) {
        hostControls.classList.remove('hidden');
    } else {
        participantMessage.classList.remove('hidden');
    }

    // Handle video file upload (host only)
    if (isHost) {
        videoFileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            uploadStatus.textContent = 'Uploading video...';
            uploadStatus.style.color = '#f39c12';

            const formData = new FormData();
            formData.append('video', file);

            try {
                const response = await fetch(`/api/rooms/${roomId}/upload`, {
                    method: 'POST',
                    body: formData,
                    headers: {
                        'X-Host-Token': hostToken
                    }
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Upload failed');
                }

                const data = await response.json();
                uploadStatus.textContent = 'Video uploaded successfully!';
                uploadStatus.style.color = '#2ecc71';

                // Set the video source
                videoPlayer.src = data.videoUrl;
                // We don't play automatically; wait for host to press play
            } catch (error) {
                uploadStatus.textContent = `Error: ${error.message}`;
                uploadStatus.style.color = '#e74c3c';
                console.error(error);
            }
        });
    }

    // Playback controls (host only)
    if (isHost) {
        playBtn.addEventListener('click', () => {
            socket.emit('playVideo', { roomId });
            videoPlayer.play();
        });

        pauseBtn.addEventListener('click', () => {
            socket.emit('pauseVideo', { roomId });
            videoPlayer.pause();
        });

        // Update video time periodically and send to server (optional)
        videoPlayer.addEventListener('timeupdate', () => {
            // Throttle the updates to avoid too many events
            if (videoPlayer.seeking) return;
            socket.emit('timeUpdate', { roomId, currentTime: videoPlayer.currentTime });
        });
    }

    // Socket.io event listeners
    socket.on('hostStatus', (data) => {
        isHost = data.isHost;
        if (isHost) {
            hostControls.classList.remove('hidden');
            participantMessage.classList.add('hidden');
        } else {
            hostControls.classList.add('hidden');
            participantMessage.classList.remove('hidden');
        }
    });

    socket.on('stateUpdate', (data) => {
        // Update video player state
        if (data.videoUrl) {
            videoPlayer.src = data.videoUrl;
        }
        if (data.isPlaying !== undefined) {
            if (data.isPlaying) {
                videoPlayer.play();
            } else {
                videoPlayer.pause();
            }
        }
        if (data.currentTime !== undefined) {
            videoPlayer.currentTime = data.currentTime;
        }
    });

    socket.on('playVideo', () => {
        videoPlayer.play();
    });

    socket.on('pauseVideo', () => {
        videoPlayer.pause();
    });

    socket.on('seekVideo', (data) => {
        videoPlayer.currentTime = data.currentTime;
    });

    socket.on('participantCount', (data) => {
        participantCountDiv.textContent = data.count;
    });

    socket.on('roomEnded', () => {
        showError('The room has been ended by the host.');
        // Disable controls
        if (isHost) {
            hostControls.classList.add('hidden');
        } else {
            participantMessage.classList.remove('hidden');
            participantMessage.textContent = 'The room has ended.';
        }
    });

    socket.on('error', (data) => {
        showError(data.message);
    });

    // Handle video ended event
    videoPlayer.addEventListener('ended', () => {
        if (isHost) {
            // Notify others that the video ended? We can just pause.
            socket.emit('pauseVideo', { roomId });
        }
    });

    // Function to show error in the room page
    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.classList.remove('hidden');
        // Hide other elements
        document.getElementById('video-container').style.display = 'none';
        if (isHost) {
            hostControls.classList.add('hidden');
        } else {
            participantMessage.classList.add('hidden');
        }
    }
}

// Initialize when the DOM is loaded
document.addEventListener('DOMContentLoaded', init);
