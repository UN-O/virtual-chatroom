"use client";

import { useGame } from "@/lib/game-context";
import { ChatList } from "./ChatList";
import { ChatWindow } from "./ChatWindow";
import { TimeBar } from "./TimeBar";
import { DebugPanel } from "./DebugPanel";
import { cn } from "@/lib/utils";

export function GameLayout() {
  const { gameState } = useGame();

  if (!gameState) return null;

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Time Bar */}
      <TimeBar />

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar - Chat List */}
        <div
          className={cn(
            "w-full shrink-0 border-r border-border md:w-80",
            gameState.activeChatId ? "hidden md:block" : "block"
          )}
        >
          <ChatList />
        </div>

        {/* Main Area - Chat Window */}
        <div
          className={cn(
            "flex-1",
            !gameState.activeChatId ? "hidden md:block" : "block"
          )}
        >
          <ChatWindow />
        </div>
      </div>

      {/* Debug Panel */}
      <DebugPanel />
    </div>
  );
}
