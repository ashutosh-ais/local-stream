import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

export default function LandingPage() {
  const navigate = useNavigate();
  const [createStatus, setCreateStatus] = useState<string>("");
  const [joinStatus, setJoinStatus] = useState<string>("");
  const [roomIdInput, setRoomIdInput] = useState<string>("");
  const [existingSessions, setExistingSessions] = useState<
    Array<{ roomId: string; videoName?: string; videoTimestamp?: string }>
  >([]);

  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const res = await fetch("/api/rooms/list");
        if (res.ok) {
          const data = await res.json();
          setExistingSessions(data);
        } else {
          console.error("Failed to fetch sessions");
        }
      } catch (e) {
        console.error("Error fetching sessions:", e);
      }
    };
    fetchSessions();
  }, []);

  const handleCreate = async () => {
    setCreateStatus("Creating room...");
    try {
      const res = await fetch("/api/rooms", { method: "POST" });
      if (!res.ok) throw new Error("Failed to create room");
      const data = await res.json();
      const { roomId, hostToken } = data;
      localStorage.setItem(`hostToken_${roomId}`, hostToken);
      navigate(`/room/${roomId}`);
    } catch (e: any) {
      setCreateStatus(`Error: ${e.message}`);
    }
  };

  const handleJoin = () => {
    const trimmed = roomIdInput.trim().toUpperCase();
    if (!trimmed) {
      setJoinStatus("Please enter a room ID");
      return;
    }
    setJoinStatus("Joining room...");
    navigate(`/room/${trimmed}`);
  };

  const handleJoinExisting = (roomId: string) => {
    navigate(`/room/${roomId}`);
  };

  return (
    <div className="container">
      <div>
        <h2>Create a Room</h2>
        <p>
          Click the button below to create a new room. Share the room ID with
          others on your local network.
        </p>
        <button
          onClick={handleCreate}
          disabled={createStatus.includes("Creating")}
        >
          {createStatus.includes("Creating") ? "Creating..." : "Create Room"}
        </button>
        {createStatus && <div className="result">{createStatus}</div>}
      </div>

      <div>
        <h2>Join a Room</h2>
        <p>Enter the room ID provided by the host.</p>
        <input
          type="text"
          value={roomIdInput}
          onChange={(e) => setRoomIdInput(e.target.value)}
          placeholder="Room ID"
          maxLength={6}
        />
        <div>
          <button
            style={{ marginTop: "10px" }}
            onClick={handleJoin}
            disabled={joinStatus.includes("Joining")}
          >
            {joinStatus.includes("Joining") ? "Joining..." : "Join Room"}
          </button>
        </div>
        {joinStatus && <div className="result">{joinStatus}</div>}
      </div>

      {existingSessions.length > 0 && (
        <div>
          <h2>Existing Sessions</h2>
          <p>Join an existing session (first joiner becomes host):</p>
          {existingSessions.map((session) => (
            <div key={session.roomId} style={{ marginBottom: "10px" }}>
              <span>
                Room ID: {session.roomId}
                {session.videoName ? ` - ${session.videoName}` : ""}
                {session.videoTimestamp
                  ? ` (${new Date(session.videoTimestamp).toLocaleString()})`
                  : ""}
              </span>
              <button
                onClick={() => handleJoinExisting(session.roomId)}
                style={{ marginLeft: "10px" }}
              >
                Join
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
