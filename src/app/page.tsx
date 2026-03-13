"use client";

import { useGame } from "@/lib/game-context";
import { StorySelection } from "@/components/StorySelection";
import { GameLayout } from "@/components/chat/GameLayout";

export default function Home() {
  const { gameState } = useGame();

  // Show story selection if no game is active
  if (!gameState) {
    return <StorySelection />;
  }

  // Show game interface when game is active
  return <GameLayout />;
}
