"use client";

import { useState, useEffect } from "react";
import { useGame } from "@/lib/game-context";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { FastForward, Clock, CheckCircle2, Bug, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import { storyPlot } from "@/lib/story-data";

export function TimeBar() {
  const { gameState, advancePhase, getCurrentPhase, toggleDebugMode, phaseStartedAt } = useGame();
  const [phaseElapsed, setPhaseElapsed] = useState(0); // 0–1 fraction of maxRealMinutes

  // Update phase timer every 100ms
  useEffect(() => {
    if (!gameState) return;
    const update = () => {
      const currentPhase = storyPlot.phases.find(
        (p) => p.id === gameState.session.currentPhaseId
      );
      if (!currentPhase || !currentPhase.maxRealMinutes) {
        setPhaseElapsed(0);
        return;
      }
      const elapsed = Date.now() - phaseStartedAt;
      const totalMs = currentPhase.maxRealMinutes * 60 * 1000;
      setPhaseElapsed(Math.min(1, elapsed / totalMs));
    };
    update();
    const id = setInterval(update, 100);
    return () => clearInterval(id);
  }, [gameState, phaseStartedAt]);

  if (!gameState) return null;

  const currentPhase = getCurrentPhase();
  const currentPhaseIndex = storyPlot.phases.findIndex(
    (p) => p.id === gameState.session.currentPhaseId
  );

  // Non-ending phases for story progress bar denominator
  const nonEndingPhases = storyPlot.phases.filter((p) => !p.id.startsWith("ending"));
  const nonEndingIndex = nonEndingPhases.findIndex(
    (p) => p.id === gameState.session.currentPhaseId
  );
  const storyProgress =
    nonEndingIndex >= 0
      ? ((nonEndingIndex + 1) / nonEndingPhases.length) * 100
      : 100; // ending phase → full bar

  const totalPhases = storyPlot.phases.length;
  const isEndingPhase = currentPhase?.id.startsWith("ending");
  const isCompleted = gameState.session.status === "completed";

  // Remaining real minutes label for phase timer
  const maxRealMinutes = currentPhase?.maxRealMinutes ?? 0;
  const elapsedMs = Date.now() - phaseStartedAt;
  const remainingMs = Math.max(0, maxRealMinutes * 60 * 1000 - elapsedMs);
  const remainingMins = Math.ceil(remainingMs / 60000);

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

        {/* Dual Progress Bars */}
        <div className="flex flex-1 flex-col gap-1.5">
          {/* Track 1: Story progress */}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>劇情進度</span>
            <span>{Math.min(currentPhaseIndex + 1, totalPhases)} / {totalPhases}</span>
          </div>
          <Progress value={storyProgress} className="h-2" />

          {/* Track 2: Phase timer (hidden for ending phases) */}
          {!isEndingPhase && !isCompleted && maxRealMinutes > 0 && (
            <>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Timer className="h-3 w-3" />
                  本階段時間
                </span>
                <span
                  className={cn(
                    remainingMins <= 1 && "text-destructive font-medium"
                  )}
                >
                  剩 {remainingMins} 分鐘
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-100",
                    phaseElapsed >= 0.8
                      ? "bg-destructive"
                      : phaseElapsed >= 0.5
                      ? "bg-amber-400"
                      : "bg-amber-300"
                  )}
                  style={{ width: `${phaseElapsed * 100}%` }}
                />
              </div>
            </>
          )}
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
