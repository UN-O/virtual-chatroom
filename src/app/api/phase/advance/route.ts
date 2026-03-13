import { storyPlot } from '@/lib/story-data';
import { determineNextPhase, getPhaseDebugInfo } from '@/lib/engine/phase';

/**
 * POST /api/phase/advance
 * 
 * Evaluates branch conditions and determines the next phase.
 * Called when fast-forward is triggered or time advances.
 * 
 * Input:
 * - currentPhaseId: string
 * - characterStates: Record<string, { pad, memory, goalAchieved }>
 * 
 * Output:
 * - nextPhaseId: string | null
 * - nextPhase: { id, progressLabel, virtualTime } | null
 * - isGameOver: boolean
 * - debugInfo: { evaluatedConditions, selectedBranch }
 */
export async function POST(req: Request) {
  const { 
    currentPhaseId, 
    characterStates = {} 
  } = await req.json();

  const currentPhase = storyPlot.phases.find(p => p.id === currentPhaseId);
  if (!currentPhase) {
    return Response.json({ error: 'Current phase not found' }, { status: 404 });
  }

  // Determine next phase using the phase engine
  const nextPhaseId = determineNextPhase(
    currentPhase,
    storyPlot.phases,
    characterStates
  );

  // Get debug info
  const debugInfo = getPhaseDebugInfo(currentPhase, characterStates);

  if (!nextPhaseId) {
    return Response.json({
      nextPhaseId: null,
      nextPhase: null,
      isGameOver: true,
      debugInfo
    });
  }

  const nextPhase = storyPlot.phases.find(p => p.id === nextPhaseId);
  
  return Response.json({
    nextPhaseId,
    nextPhase: nextPhase ? {
      id: nextPhase.id,
      progressLabel: nextPhase.progressLabel,
      virtualTime: nextPhase.virtualTime
    } : null,
    isGameOver: !nextPhase,
    debugInfo
  });
}
