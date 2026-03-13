"use client";

import { useGame } from "@/lib/game-context";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { FastForward, Clock, CheckCircle2, Bug } from "lucide-react";
import { cn } from "@/lib/utils";
import { storyPlot } from "@/lib/story-data";

export function TimeBar() {
  const { gameState, advancePhase, getCurrentPhase, toggleDebugMode } = useGame();

  if (!gameState) return null;

  const currentPhase = getCurrentPhase();
  const currentPhaseIndex = storyPlot.phases.findIndex(
    (p) => p.id === gameState.session.currentPhaseId
  );
  const totalPhases = storyPlot.phases.length;
  const progress = ((currentPhaseIndex + 1) / totalPhases) * 100;

  const isEndingPhase = currentPhase?.id.startsWith("ending");
  const isCompleted = gameState.session.status === 'completed';

  return (
    <div className="border-b border-border bg-card px-4 py-3">
      <div className="flex items-center gap-4">
        {/* Time Display */}
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--time-badge)]">
            <Clock className="h-5 w-5 text-[var(--time-badge-foreground)]" />
          </div>
          <div className="flex flex-col">
            <span className="text-lg font-bold text-foreground">
              {gameState.session.virtualTime}
            </span>
            <span className="text-xs text-muted-foreground">
              {gameState.session.progressLabel}
            </span>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="flex flex-1 flex-col gap-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>劇情進度</span>
            <span>{currentPhaseIndex + 1} / {totalPhases}</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        {/* Fast Forward Button */}
        {!isCompleted && (
          <Button
            onClick={advancePhase}
            disabled={!gameState.canFastForward}
            variant={gameState.canFastForward ? "default" : "secondary"}
            size="sm"
            className={cn(
              "gap-2",
              gameState.canFastForward && "animate-pulse"
            )}
          >
            {isEndingPhase ? (
              <>
                <CheckCircle2 className="h-4 w-4" />
                結束
              </>
            ) : (
              <>
                <FastForward className="h-4 w-4" />
                快進
              </>
            )}
          </Button>
        )}

        {isCompleted && (
          <div className="flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 text-sm font-medium text-primary">
            <CheckCircle2 className="h-4 w-4" />
            故事結束
          </div>
        )}

        {/* Debug Toggle */}
        <Button
          onClick={toggleDebugMode}
          variant="ghost"
          size="icon"
          className={cn(
            "h-8 w-8",
            gameState.debugMode && "bg-primary/10 text-primary"
          )}
          title="Toggle Debug Panel"
        >
          <Bug className="h-4 w-4" />
        </Button>
      </div>

      {/* Goal Status Hints */}
      {currentPhase && !isCompleted && (
        <div className="mt-3 flex flex-wrap gap-2">
          {currentPhase.characterMissions.map((mission) => {
            const charState = gameState.session.characterStates[mission.characterId];
            const isAchieved = charState?.goalAchieved;

            return (
              <div
                key={mission.characterId}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  isAchieved
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {isAchieved ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : (
                  <span className="h-2 w-2 rounded-full bg-current opacity-50" />
                )}
                {mission.characterId === "char_boss" ? "陳副理" : "小林"}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
