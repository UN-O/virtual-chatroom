"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useGame } from "@/lib/game-context";
import { GameLayout } from "@/components/chat/GameLayout";

export default function GamePage() {
  const params = useParams();
  const sessionId = params.sessionId as string;
  const { loadSession, session, isLoading } = useGame();
  
  // Track if we attempted to load
  const [hasAttemptedLoad, setHasAttemptedLoad] = useState(false);

  useEffect(() => {
    if (sessionId) {
      loadSession(sessionId);
      setHasAttemptedLoad(true);
    }
  }, [sessionId, loadSession]);

  if (isLoading || !hasAttemptedLoad) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-100 text-gray-500">
        Loading Session {sessionId}...
      </div>
    );
  }

  // If loaded, but session is null or ID doesn't match => Not Found
  if (!session || session.id !== sessionId) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-6 bg-gray-50 text-center p-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">找不到遊戲存檔</h1>
          <p className="mt-2 text-gray-600">Session ID: {sessionId}</p>
        </div>
        
        <a 
          href="/" 
          className="rounded-lg bg-blue-600 px-6 py-3 text-white shadow hover:bg-blue-700 transition"
        >
          回到大廳
        </a>
      </div>
    );
  }

  return <GameLayout />;
}
