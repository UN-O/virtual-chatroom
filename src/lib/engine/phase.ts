import type { Phase, CharacterState, BranchCondition } from '../types';

/**
 * Phase Engine
 * 
 * Handles phase transitions and branch condition evaluation.
 * This is a pure frontend engine - no LLM calls needed.
 */

/**
 * Evaluate a single branch condition against current character states
 * 
 * Condition syntax examples:
 * - "char_boss.p > 0.3" - Check if boss's pleasure is above 0.3
 * - "char_boss.p <= 0.3 || !goal_afternoon_char_boss_achieved" - Complex condition
 * - "goal_morning_char_boss_achieved" - Check if goal is achieved
 */
export function evaluateCondition(
  condition: string,
  characterStates: Record<string, CharacterState>,
  currentPhaseId: string
): boolean {
  // Handle empty or always-true conditions
  if (!condition || condition.trim() === '') return true;
  
  // Parse the condition
  const normalizedCondition = condition.trim();
  
  // Split by OR (||)
  const orParts = normalizedCondition.split('||').map(p => p.trim());
  
  for (const orPart of orParts) {
    // Split by AND (&&)
    const andParts = orPart.split('&&').map(p => p.trim());
    
    let allAndPass = true;
    for (const part of andParts) {
      if (!evaluateSingleCondition(part, characterStates, currentPhaseId)) {
        allAndPass = false;
        break;
      }
    }
    
    if (allAndPass) return true;
  }
  
  return false;
}

/**
 * Evaluate a single atomic condition (no && or ||)
 */
function evaluateSingleCondition(
  condition: string,
  characterStates: Record<string, CharacterState>,
  currentPhaseId: string
): boolean {
  const trimmed = condition.trim();
  
  // Handle negation
  if (trimmed.startsWith('!')) {
    return !evaluateSingleCondition(trimmed.slice(1), characterStates, currentPhaseId);
  }
  
  // Handle goal achievement checks
  // Format: goal_<phaseId>_<characterId>_achieved
  const goalMatch = trimmed.match(/goal_(\w+)_(\w+)_achieved/);
  if (goalMatch) {
    const [, phaseId, characterId] = goalMatch;
    const charState = characterStates[characterId];
    // Only check goals for current or past phases
    return charState?.goalAchieved || false;
  }
  
  // Handle PAD comparisons
  // Format: char_<id>.<pad_attr> <op> <value>
  const padMatch = trimmed.match(/(\w+)\.([pad])\s*(>|<|>=|<=|==|!=)\s*([-\d.]+)/);
  if (padMatch) {
    const [, characterId, attr, op, valueStr] = padMatch;
    const charState = characterStates[characterId];
    if (!charState) return false;
    
    const currentValue = charState.pad[attr as keyof typeof charState.pad];
    const targetValue = parseFloat(valueStr);
    
    switch (op) {
      case '>': return currentValue > targetValue;
      case '<': return currentValue < targetValue;
      case '>=': return currentValue >= targetValue;
      case '<=': return currentValue <= targetValue;
      case '==': return currentValue === targetValue;
      case '!=': return currentValue !== targetValue;
      default: return false;
    }
  }
  
  // Handle simple goal checks without phase
  // Format: goal_<phaseId>_achieved
  const simpleGoalMatch = trimmed.match(/goal_(\w+)_achieved/);
  if (simpleGoalMatch) {
    const [, phaseId] = simpleGoalMatch;
    // Check if all character goals for this phase are achieved
    return Object.values(characterStates).every(s => s.goalAchieved);
  }
  
  // Default: unknown condition format, return false for safety
  console.warn(`[PhaseEngine] Unknown condition format: ${trimmed}`);
  return false;
}

/**
 * Determine the next phase based on current state and branch conditions
 */
export function determineNextPhase(
  currentPhase: Phase,
  allPhases: Phase[],
  characterStates: Record<string, CharacterState>
): string | null {
  // Evaluate each branch condition in order
  for (const branch of currentPhase.branches) {
    if (evaluateCondition(branch.condition, characterStates, currentPhase.id)) {
      return branch.nextPhaseId;
    }
  }
  
  // If no branch matched, try to find the next phase by index
  const currentIndex = allPhases.findIndex(p => p.id === currentPhase.id);
  if (currentIndex >= 0 && currentIndex < allPhases.length - 1) {
    // Check if next phase is an ending - if so, we need branch conditions
    const nextPhase = allPhases[currentIndex + 1];
    if (nextPhase.id.startsWith('ending')) {
      // Don't auto-advance to ending phases without branch match
      return null;
    }
    return nextPhase.id;
  }
  
  // No more phases
  return null;
}

/**
 * Check if all goals for a phase are achieved
 */
export function areAllGoalsAchieved(
  phase: Phase,
  characterStates: Record<string, CharacterState>
): boolean {
  return phase.characterMissions.every(mission => {
    const charState = characterStates[mission.characterId];
    return charState?.goalAchieved || false;
  });
}

/**
 * Get a description of the current phase state for debugging
 */
export function getPhaseDebugInfo(
  phase: Phase,
  characterStates: Record<string, CharacterState>
): {
  phaseId: string;
  virtualTime: string;
  progressLabel: string;
  goals: Array<{
    characterId: string;
    goal: string;
    achieved: boolean;
    padP: number;
    padA: number;
    padD: number;
  }>;
  branchEvaluations: Array<{
    condition: string;
    nextPhaseId: string;
    wouldTrigger: boolean;
  }>;
} {
  const goals = phase.characterMissions.map(mission => {
    const charState = characterStates[mission.characterId];
    return {
      characterId: mission.characterId,
      goal: mission.goal,
      achieved: charState?.goalAchieved || false,
      padP: charState?.pad.p || 0,
      padA: charState?.pad.a || 0,
      padD: charState?.pad.d || 0,
    };
  });
  
  const branchEvaluations = phase.branches.map(branch => ({
    condition: branch.condition,
    nextPhaseId: branch.nextPhaseId,
    wouldTrigger: evaluateCondition(branch.condition, characterStates, phase.id),
  }));
  
  return {
    phaseId: phase.id,
    virtualTime: phase.virtualTime,
    progressLabel: phase.progressLabel,
    goals,
    branchEvaluations,
  };
}
