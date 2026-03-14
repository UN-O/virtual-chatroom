"use client";

import { useGame } from "@/lib/game-context";
import { cn } from "@/lib/utils";
import { X, Bug, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { characters } from "@/lib/story-data";
import { getPhaseDebugInfo } from "@/lib/engine/phase";

/**
 * Debug Panel Component
 * 
 * Shows:
 * - Current PAD values for each character
 * - Goal achievement status
 * - Branch condition evaluations
 * - Pending events in the virtual time engine
 */
export function DebugPanel() {
  const { gameState, toggleDebugMode, getCurrentPhase, autonomyModes } = useGame();
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    autonomy: true,
    pad: true,
    memory: true,
    goals: true,
    branches: false,
    events: false,
  });

  if (!gameState?.debugMode) return null;

  const currentPhase = getCurrentPhase();
  const debugInfo = currentPhase 
    ? getPhaseDebugInfo(currentPhase, gameState.session.characterStates)
    : null;

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 max-h-[60vh] overflow-hidden rounded-lg border border-border bg-card shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-2">
        <div className="flex items-center gap-2">
          <Bug className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-foreground">Debug Panel</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={toggleDebugMode}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="overflow-y-auto max-h-[calc(60vh-40px)] p-3">
        {/* Phase Info */}
        {debugInfo && (
          <div className="mb-3 rounded-md bg-primary/10 p-2">
            <div className="text-xs font-medium text-primary">
              Phase: {debugInfo.phaseId}
            </div>
            <div className="text-xs text-muted-foreground">
              {debugInfo.virtualTime} - {debugInfo.progressLabel}
            </div>
          </div>
        )}

        {/* Autonomy Mode Section */}
        <SectionHeader
          title="Autonomy Mode"
          expanded={expandedSections.autonomy}
          onToggle={() => toggleSection('autonomy')}
        />
        {expandedSections.autonomy && (
          <div className="mb-3 space-y-1">
            {Object.values(characters).map(char => {
              const mode = autonomyModes[char.id] ?? 'idle';
              return (
                <div key={`autonomy-${char.id}`} className="flex items-center justify-between rounded-md border border-border p-2 text-xs">
                  <span className="font-medium text-foreground">{char.profile.name}</span>
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase",
                      mode === 'checking' && "bg-blue-500/20 text-blue-700",
                      mode === 'waiting-update' && "bg-amber-500/20 text-amber-700",
                      mode === 'idle' && "bg-muted text-muted-foreground"
                    )}
                  >
                    {mode}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* PAD Values Section */}
        <SectionHeader
          title="PAD Values"
          expanded={expandedSections.pad}
          onToggle={() => toggleSection('pad')}
        />
        {expandedSections.pad && (
          <div className="mb-3 space-y-2">
            {Object.values(characters).map(char => {
              const state = gameState.session.characterStates[char.id];
              if (!state) return null;

              return (
                <div key={char.id} className="rounded-md border border-border p-2">
                  <div className="mb-1 text-xs font-medium text-foreground">
                    {char.profile.name}
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    <PADBar label="P" value={state.pad.p} min={-1} max={1} color="bg-green-500" />
                    <PADBar label="A" value={state.pad.a} min={0} max={1} color="bg-yellow-500" />
                    <PADBar label="D" value={state.pad.d} min={-1} max={1} color="bg-blue-500" />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Memory Section */}
        <SectionHeader
          title="Character Memory"
          expanded={expandedSections.memory}
          onToggle={() => toggleSection('memory')}
        />
        {expandedSections.memory && (
          <div className="mb-3 space-y-2">
            {Object.values(characters).map(char => {
              const state = gameState.session.characterStates[char.id];
              if (!state) return null;

              return (
                <div key={`memory-${char.id}`} className="rounded-md border border-border p-2">
                  <div className="mb-1 text-xs font-medium text-foreground">
                    {char.profile.name}
                  </div>
                  <div className="text-xs text-muted-foreground whitespace-pre-wrap wrap-break-word">
                    {state.memory || "(empty)"}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Goals Section */}
        <SectionHeader
          title="Goals"
          expanded={expandedSections.goals}
          onToggle={() => toggleSection('goals')}
        />
        {expandedSections.goals && debugInfo && (
          <div className="mb-3 space-y-1">
            {debugInfo.goals.map(goal => (
              <div
                key={goal.characterId}
                className={cn(
                  "rounded-md border p-2 text-xs",
                  goal.achieved 
                    ? "border-green-500/30 bg-green-500/10 text-green-700" 
                    : "border-border bg-muted text-muted-foreground"
                )}
              >
                <div className="font-medium">
                  {characters[goal.characterId]?.profile.name || goal.characterId}
                  {goal.achieved && " (Done)"}
                </div>
                <div className="mt-0.5 opacity-80 line-clamp-2">{goal.goal}</div>
              </div>
            ))}
          </div>
        )}

        {/* Branches Section */}
        <SectionHeader
          title="Branch Conditions"
          expanded={expandedSections.branches}
          onToggle={() => toggleSection('branches')}
        />
        {expandedSections.branches && debugInfo && (
          <div className="mb-3 space-y-1">
            {debugInfo.branchEvaluations.map((branch, i) => (
              <div
                key={i}
                className={cn(
                  "rounded-md border p-2 text-xs",
                  branch.wouldTrigger 
                    ? "border-primary/30 bg-primary/10" 
                    : "border-border bg-muted"
                )}
              >
                <div className="font-mono text-[10px] opacity-80">{branch.condition}</div>
                <div className="mt-0.5 flex items-center justify-between">
                  <span>-{">"} {branch.nextPhaseId}</span>
                  <span className={cn(
                    "rounded px-1 py-0.5 text-[10px]",
                    branch.wouldTrigger ? "bg-green-500 text-white" : "bg-muted-foreground/20"
                  )}>
                    {branch.wouldTrigger ? "MATCH" : "no"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}

function SectionHeader({ 
  title, 
  expanded, 
  onToggle 
}: { 
  title: string; 
  expanded: boolean; 
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="flex w-full items-center gap-1 py-1 text-xs font-medium text-foreground hover:text-primary"
    >
      {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      {title}
    </button>
  );
}

function PADBar({ 
  label, 
  value, 
  min, 
  max, 
  color 
}: { 
  label: string; 
  value: number; 
  min: number; 
  max: number; 
  color: string;
}) {
  // Normalize value to 0-100 percentage
  const percentage = ((value - min) / (max - min)) * 100;
  const centerPos = min < 0 ? 50 : 0;

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between text-[10px]">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">{value.toFixed(2)}</span>
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
        {min < 0 && (
          <div className="absolute left-1/2 top-0 h-full w-px bg-border" />
        )}
        <div
          className={cn("absolute top-0 h-full rounded-full", color)}
          style={{
            left: min < 0 ? `${Math.min(centerPos, percentage)}%` : '0%',
            width: min < 0 
              ? `${Math.abs(percentage - centerPos)}%`
              : `${percentage}%`,
          }}
        />
      </div>
    </div>
  );
}
