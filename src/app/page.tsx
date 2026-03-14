"use client";

import { useGame } from "@/lib/game-context";
import { useRouter } from "next/navigation";
import { useState, MouseEvent } from "react";
import { testLLM, testStructuredLLM } from "./actions";
import { Trash2 } from "lucide-react";

export default function Home() {
  const { sessions, createSession, deleteSession } = useGame();
  const router = useRouter();
  const [testResult, setTestResult] = useState<string>("");
  const [isTestExpanded, setIsTestExpanded] = useState(false);

  const handleNewGame = () => {
    const newId = createSession();
    router.push(`/game/${newId}`);
  };

  const handleContinue = (id: string) => {
    router.push(`/game/${id}`);
  };

  const handleDelete = (e: MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm("確定要刪除這個存檔嗎？")) {
      deleteSession(id);
    }
  };

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

  return (
    <main className="min-h-screen bg-background text-foreground p-8 flex flex-col items-center gap-10">
      <header className="text-center space-y-2">
        <h1 className="text-4xl font-bold tracking-tight text-foreground">Virtual Chatroom</h1>
        <p className="text-muted-foreground">互動劇情體驗 v0.2</p>
      </header>

      <div className="w-full max-w-md space-y-6">
        {/* Main Action */}
        <button
          onClick={handleNewGame}
          className="w-full py-4 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl shadow-lg font-bold text-lg transition-all transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2"
        >
          <span>＋ 開始新劇情</span>
        </button>

        {/* Sessions List */}
        <section className="space-y-4">
          <div className="flex justify-between items-end px-1">
            <h2 className="text-lg font-semibold text-foreground">遊戲存檔</h2>
            <span className="text-xs text-muted-foreground">{sessions.length} 個紀錄</span>
          </div>

          {sessions.length === 0 ? (
            <div className="text-center py-12 bg-card rounded-xl border-2 border-dashed border-border text-muted-foreground">
              尚無存檔紀錄
              <br />
              <span className="text-sm">點擊上方按鈕開始新的冒險</span>
            </div>
          ) : (
            <div className="space-y-3">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  onClick={() => handleContinue(session.id)}
                  className="group relative bg-card border border-border rounded-xl p-4 cursor-pointer hover:border-primary/40 hover:shadow-md transition-all"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-semibold text-foreground">
                        {session.progressLabel || "序章"}
                      </h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        最後遊玩: {new Date(session.lastActiveAt).toLocaleString('zh-TW')}
                      </p>
                       <p className="text-xs text-muted-foreground mt-1 font-mono">
                        ID: {session.id.substring(0, 8)}...
                      </p>
                    </div>
                    <button
                      onClick={(e) => handleDelete(e, session.id)}
                      className="opacity-0 group-hover:opacity-100 p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-full transition-all"
                      title="刪除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

       {/* Developer Tools */}
       <div className="w-full max-w-md border-t border-border pt-6 mt-4">
        <button
          onClick={() => setIsTestExpanded(!isTestExpanded)}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mx-auto"
        >
          {isTestExpanded ? "隱藏開發工具" : "顯示開發工具 (LLM Test)"}
        </button>

        {isTestExpanded && (
          <div className="mt-4 p-4 bg-muted rounded-lg space-y-3 text-sm animate-in fade-in slide-in-from-top-2">
            <div className="flex gap-2 justify-center">
              <button onClick={handleTest} className="px-3 py-1 bg-card border border-border rounded hover:bg-muted">Test Text</button>
              <button onClick={handleStructuredTest} className="px-3 py-1 bg-card border border-border rounded hover:bg-muted">Test Object</button>
            </div>
            {testResult && (
              <pre className="p-2 bg-black text-green-400 text-xs rounded overflow-auto max-h-40 whitespace-pre-wrap">
                {testResult}
              </pre>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
