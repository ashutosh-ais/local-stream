import {
  useState,
  useEffect,
  useContext,
  useRef,
  type ChangeEvent,
} from "react";
import { useParams } from "react-router-dom";
import { SocketContext } from "./socketContext";

export default function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const { socket, navigate } = useContext(SocketContext);

  const hostTokenRef = useRef<string | null>(
    roomId ? localStorage.getItem(`hostToken_${roomId}`) : null
  );
  const [hostToken, setHostToken] = useState<string | null>(() => {
    return roomId ? localStorage.getItem(`hostToken_${roomId}`) : null;
  });
  const [isHost, setIsHost] = useState<boolean>(() => {
    return roomId ? !!localStorage.getItem(`hostToken_${roomId}`) : false;
  });

  const [videoUrl, setVideoUrl] = useState<string>("");
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [participantCount, setParticipantCount] = useState<number>(0);
  const [uploadStatus, setUploadStatus] = useState<string>("");
  const [error, setError] = useState<string>("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const lastEmitTimeRef = useRef(0);

  // Set up socket connection and listeners (runs ONCE per room)
  useEffect(() => {
    if (!socket || !roomId) return;

    // Listen for events
    const handleHostStatus = (data: { isHost: boolean; hostToken?: string }) => {
      setIsHost(data.isHost);
      if (data.isHost && data.hostToken) {
        hostTokenRef.current = data.hostToken;
        localStorage.setItem(`hostToken_${roomId}`, data.hostToken);
        setHostToken(data.hostToken);
      } else if (!data.isHost) {
        hostTokenRef.current = null;
        setHostToken(null);
      }
    };

    const handleStateUpdate = (data: {
      videoUrl?: string;
      isPlaying?: boolean;
      currentTime?: number;
    }) => {
      if (data.videoUrl) {
        setVideoUrl((prev) => (prev !== data.videoUrl ? data.videoUrl! : prev));
      }
      if (data.isPlaying !== undefined) {
        setIsPlaying(data.isPlaying);
      }
      if (data.currentTime !== undefined && videoRef.current) {
        if (Math.abs(videoRef.current.currentTime - data.currentTime) > 1.5) {
          videoRef.current.currentTime = data.currentTime;
        }
      }
    };

    const handlePlayVideo = (data?: { currentTime?: number }) => {
      setIsPlaying(true);
      if (
        data?.currentTime !== undefined &&
        videoRef.current &&
        Math.abs(videoRef.current.currentTime - data.currentTime) > 0.5
      ) {
        videoRef.current.currentTime = data.currentTime;
      }
      if (videoRef.current && videoRef.current.paused) {
        videoRef.current.play().catch((err) => {
          console.warn("Play failed:", err);
        });
      }
    };

    const handlePauseVideo = (data?: { currentTime?: number }) => {
      setIsPlaying(false);
      if (
        data?.currentTime !== undefined &&
        videoRef.current &&
        Math.abs(videoRef.current.currentTime - data.currentTime) > 0.5
      ) {
        videoRef.current.currentTime = data.currentTime;
      }
      if (videoRef.current && !videoRef.current.paused) {
        videoRef.current.pause();
      }
    };

    const handleSeekVideo = (data: { currentTime: number }) => {
      if (
        videoRef.current &&
        Math.abs(videoRef.current.currentTime - data.currentTime) > 0.5
      ) {
        videoRef.current.currentTime = data.currentTime;
      }
    };

    const handleParticipantCount = (data: { count: number }) => {
      setParticipantCount(data.count);
    };

    const handleRoomEnded = () => {
      setError("The room has been ended by the host.");
      setTimeout(() => navigate("/"), 3000);
    };

    const handleSocketError = (data: { message: string }) => {
      setError(data.message);
    };

    socket.on("hostStatus", handleHostStatus);
    socket.on("stateUpdate", handleStateUpdate);
    socket.on("playVideo", handlePlayVideo);
    socket.on("pauseVideo", handlePauseVideo);
    socket.on("seekVideo", handleSeekVideo);
    socket.on("participantCount", handleParticipantCount);
    socket.on("roomEnded", handleRoomEnded);
    socket.on("error", handleSocketError);

    // Join room ONCE using token from ref or localStorage
    const currentToken =
      hostTokenRef.current || (roomId ? localStorage.getItem(`hostToken_${roomId}`) : null);
    socket.emit("joinRoom", { roomId, hostToken: currentToken });

    // Cleanup when leaving room
    return () => {
      socket.emit("leaveRoom", { roomId });
      socket.off("hostStatus", handleHostStatus);
      socket.off("stateUpdate", handleStateUpdate);
      socket.off("playVideo", handlePlayVideo);
      socket.off("pauseVideo", handlePauseVideo);
      socket.off("seekVideo", handleSeekVideo);
      socket.off("participantCount", handleParticipantCount);
      socket.off("roomEnded", handleRoomEnded);
      socket.off("error", handleSocketError);
    };
  }, [socket, roomId, navigate]);

  // Load video source only if changed
  useEffect(() => {
    if (videoRef.current && videoUrl) {
      if (
        !videoRef.current.currentSrc ||
        !videoRef.current.currentSrc.includes(videoUrl)
      ) {
        videoRef.current.load();
      }
    }
  }, [videoUrl]);

  // Sync video play/pause with state
  useEffect(() => {
    if (!videoRef.current) return;
    if (isPlaying) {
      if (videoRef.current.paused) {
        videoRef.current.play().catch((err) => {
          console.warn("Play failed (effect):", err);
        });
      }
    } else {
      if (!videoRef.current.paused) {
        videoRef.current.pause();
      }
    }
  }, [isPlaying]);

  // Handle video ended
  const handleEnded = () => {
    setIsPlaying(false);
    if (isHost && socket && roomId) {
      socket.emit("pauseVideo", { roomId });
    }
  };

  // Handle file selection and upload
  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const token =
      hostTokenRef.current ||
      hostToken ||
      (roomId ? localStorage.getItem(`hostToken_${roomId}`) : null);
    if (!file || !token || !roomId) return;

    setUploadStatus("Uploading video...");
    const formData = new FormData();
    formData.append("video", file);

    try {
      const res = await fetch(`/api/rooms/${roomId}/upload`, {
        method: "POST",
        body: formData,
        headers: {
          "X-Host-Token": token,
        },
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Upload failed");
      }

      const data = await res.json();
      setUploadStatus("Video uploaded successfully!");
      setVideoUrl(data.videoUrl);

      // Force video element to load the new URL right away
      if (videoRef.current) {
        videoRef.current.src = data.videoUrl;
        videoRef.current.load();
      }
    } catch (err: any) {
      setUploadStatus(`Error: ${err.message}`);
    }
  };

  // Host playback controls (buttons)
  const handlePlay = () => {
    if (videoRef.current) {
      videoRef.current.play().catch((err) => {
        console.warn("Play failed:", err);
      });
    }
    if (socket && roomId) {
      socket.emit("playVideo", {
        roomId,
        currentTime: videoRef.current?.currentTime ?? 0,
      });
    }
    setIsPlaying(true);
  };

  const handlePause = () => {
    if (videoRef.current) {
      videoRef.current.pause();
    }
    if (socket && roomId) {
      socket.emit("pauseVideo", {
        roomId,
        currentTime: videoRef.current?.currentTime ?? 0,
      });
    }
    setIsPlaying(false);
  };

  // Video element native controls sync (in case user clicks play/pause directly on the player)
  const handleVideoPlay = () => {
    if (!isPlaying) {
      setIsPlaying(true);
      if (isHost && socket && roomId) {
        socket.emit("playVideo", {
          roomId,
          currentTime: videoRef.current?.currentTime ?? 0,
        });
      }
    }
  };

  const handleVideoPause = () => {
    if (isPlaying) {
      setIsPlaying(false);
      if (isHost && socket && roomId) {
        socket.emit("pauseVideo", {
          roomId,
          currentTime: videoRef.current?.currentTime ?? 0,
        });
      }
    }
  };

  const handleVideoSeeked = () => {
    if (isHost && socket && roomId && videoRef.current) {
      socket.emit("seekVideo", {
        roomId,
        currentTime: videoRef.current.currentTime,
      });
    }
  };

  // Broadcast time updates periodically if host (to keep participants in sync)
  const handleTimeUpdate = () => {
    if (
      isHost &&
      socket &&
      roomId &&
      videoRef.current &&
      !videoRef.current.seeking
    ) {
      const now = Date.now();
      if (now - lastEmitTimeRef.current < 500) return;
      lastEmitTimeRef.current = now;
      socket.emit("timeUpdate", {
        roomId,
        currentTime: videoRef.current.currentTime,
      });
    }
  };

  const shareableUrl = `${window.location.origin}/room/${roomId}`;

  if (error) {
    return (
      <div className="container">
        <h1>Error</h1>
        <p className="error">{error}</p>
        <p>
          <button onClick={() => navigate("/")}>Back to Home</button>
        </p>
      </div>
    );
  }

  return (
    <div className="container">
      <div id="room-info">
        <p>
          Room ID: <span>{roomId}</span>
        </p>
        <p>Share this URL with others on your local network:</p>
        <p id="room-url">{shareableUrl}</p>
      </div>

      <div id="video-container">
        <video
          ref={videoRef}
          id="video-player"
          controls={isHost}
          playsInline
          preload="auto"
          src={videoUrl || undefined}
          onPlay={handleVideoPlay}
          onPause={handleVideoPause}
          onSeeked={handleVideoSeeked}
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleEnded}
        >
          Your browser does not support the video tag.
        </video>
        {!isHost && !videoUrl && (
          <div id="participant-message">
            <p>Waiting for the host to start the video...</p>
          </div>
        )}
      </div>

      {isHost && (
        <div id="host-controls">
          <h2>Host Controls</h2>
          <input
            type="file"
            id="video-file-input"
            accept="video/*"
            onChange={handleFileChange}
          />
          {uploadStatus && <div id="upload-status">{uploadStatus}</div>}
          <div id="playback-controls">
            <button onClick={handlePlay} disabled={!videoUrl}>
              Play
            </button>
            <button onClick={handlePause} disabled={!videoUrl}>
              Pause
            </button>
          </div>
          <div id="participants">
            <h3>Connected Participants:</h3>
            <div id="participant-count">{participantCount}</div>
          </div>
        </div>
      )}

      {!isHost && (
        <div id="participants">
          <h3>Connected Participants:</h3>
          <div id="participant-count">{participantCount}</div>
        </div>
      )}
    </div>
  );
}
