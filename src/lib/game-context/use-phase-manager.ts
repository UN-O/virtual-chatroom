'use client';

/**
 * use-phase-manager.ts — usePhaseManager hook
 *
 * 封裝 GameProvider 的 Phase 推進邏輯：
 *  1. 評估 branch conditions（determineNextPhase）
 *  2. 更新 session 的 currentPhaseId / virtualTime / status
 *  3. Reset phaseStartedAtRef（供 virtualTimeLabel 計算使用）
 *  4. 呼叫 /api/event/phase-start，依序插入角色主動開場訊息
 */

import { useCallback } from 'react';
import type { MutableRefObject, Dispatch, SetStateAction } from 'react';

import { computeVirtualTimeLabel } from './helpers';
import { storyPlot } from '../story-data';
import { determineNextPhase } from '../engine/phase';

import type { ClientSession } from '../types';

// ── Options ───────────────────────────────────────────────────────────────────

export interface UsePhaseManagerOptions {
    /** async callback 內讀取最新 session（避免 stale closure） */
    sessionRef: MutableRefObject<ClientSession | null>;
    /** 記錄 phase 真實開始時間，advancePhase 時 reset */
    phaseStartedAtRef: MutableRefObject<number>;
    /** React setState dispatcher */
    setSession: Dispatch<SetStateAction<ClientSession | null>>;
    /** Reactive setState for phase start time — triggers re-render of TimeBar phase timer */
    setPhaseStartedAt: Dispatch<SetStateAction<number>>;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function usePhaseManager({
    sessionRef,
    phaseStartedAtRef,
    setSession,
    setPhaseStartedAt,
}: UsePhaseManagerOptions) {
    const advancePhase = useCallback(async () => {
        const cur = sessionRef.current;
        if (!cur) return;

        const currentPhase = storyPlot.phases.find(p => p.id === cur.currentPhaseId);
        if (!currentPhase) return;

        const nextPhaseId = determineNextPhase(currentPhase, storyPlot.phases, cur.characterStates);
        if (!nextPhaseId) {
            console.log('[Phase] 無法推進：故事結束或條件未達成');
            return;
        }

        const nextPhase = storyPlot.phases.find(p => p.id === nextPhaseId);
        if (!nextPhase) return;

        const isEnding = nextPhase.id.startsWith('ending');
        // Reset phase timer — update both the ref (for virtualTimeLabel) and reactive state (for TimeBar)
        const now = Date.now();
        phaseStartedAtRef.current = now;
        setPhaseStartedAt(now);
        setSession(prev => prev ? {
            ...prev,
            currentPhaseId: nextPhase.id,
            progressLabel: nextPhase.progressLabel,
            virtualTime: nextPhase.virtualTime,
            status: isEnding ? 'completed' : prev.status
        } : null);

        try {
            const phaseStart = Date.now();
            const res = await fetch('/api/event/phase-start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    phaseId: nextPhase.id,
                    characterStates: cur.characterStates,
                    chatHistories: {}
                })
            });
            if (!res.ok) throw new Error(`phase-start API error ${res.status}`);
            const data = await res.json();

            if (Array.isArray(data.messages)) {
                data.messages.forEach((msg: {
                    characterId: string;
                    chatId: string;
                    content: string;
                    expressionKey?: string;
                }, index: number) => {
                    const delay = 1000 + index * 1500 + Math.random() * 1000;
                    setTimeout(() => {
                        const vtLabel = computeVirtualTimeLabel(nextPhase.virtualTime, Date.now() - phaseStart);
                        setSession(prev => prev ? {
                            ...prev,
                            messages: [...prev.messages, {
                                id: `phase_${Date.now()}_${index}`,
                                chatId: msg.chatId,
                                senderType: 'character',
                                senderId: msg.characterId,
                                content: msg.content,
                                expressionKey: msg.expressionKey,
                                virtualTimeLabel: vtLabel,
                                createdAt: new Date()
                            }]
                        } : null);
                    }, delay);
                });
            }
        } catch (e) {
            console.error('[Phase] phase-start 觸發失敗', e);
        }
    }, [sessionRef, phaseStartedAtRef, setSession]);

    return { advancePhase };
}
