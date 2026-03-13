"use client";

import { useGame } from "@/lib/game-context";
import { StorySelection } from "@/components/StorySelection";
import { GameLayout } from "@/components/chat/GameLayout";
import { useState } from "react";
import { testLLM, testStructuredLLM } from "./actions";

export default function Home() {
  const { gameState } = useGame();
  const [testResult, setTestResult] = useState<string>("");

  const handleTest = async () => {
    setTestResult("Testing Text...");
    const result = await testLLM();
    setTestResult(result.success ? `Text Success: ${result.text}` : `Error: ${result.error}`);
  };

  const handleStructuredTest = async () => {
    setTestResult("Testing Object...");
    const result = await testStructuredLLM();
    setTestResult(result.success ? `Object Success:\n${JSON.stringify(result.data, null, 2)}` : `Error: ${result.error}`);
  };

  // Show story selection if no game is active
  if (!gameState) {
    return (
      <main className="relative min-h-screen">
        <div className="absolute top-4 right-4 z-50 flex flex-col items-end gap-2">
          <div className="flex gap-2">
            <button 
              onClick={handleTest}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded shadow-lg text-sm transition-colors"
            >
              Test Text
            </button>
            <button 
              onClick={handleStructuredTest}
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded shadow-lg text-sm transition-colors"
            >
              Test Object
            </button>
          </div>
          {testResult && (
            <div className="bg-white/90 backdrop-blur text-black p-3 rounded shadow-lg max-w-xs text-xs border border-gray-200 whitespace-pre-wrap font-mono">
              {testResult}
            </div>
          )}
        </div>
        <StorySelection />
      </main>
    );
  }

  // Show game interface when game is active
  return <GameLayout />;
}
