"use client";

import { useGame } from "@/lib/game-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { storyPlot } from "@/lib/story-data";
import { Clock, Users, MessageCircle, Play } from "lucide-react";

export function StorySelection() {
  const { startGame } = useGame();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary">
              <MessageCircle className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Story Chat</h1>
              <p className="text-xs text-muted-foreground">互動劇情遊戲</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-4xl px-4 py-8">
        {/* Hero Section */}
        <div className="mb-8 text-center">
          <h2 className="mb-3 text-3xl font-bold text-foreground text-balance">
            透過聊天體驗故事
          </h2>
          <p className="mx-auto max-w-md text-muted-foreground text-pretty">
            在仿 LINE 的介面中與 AI 角色互動，你的每個選擇都會影響故事走向
          </p>
        </div>

        {/* Story Card */}
        <Card className="overflow-hidden border-border bg-card shadow-lg transition-shadow hover:shadow-xl">
          <div className="relative h-48 bg-gradient-to-br from-primary/20 via-primary/10 to-transparent">
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="rounded-full bg-card/90 p-6 shadow-lg backdrop-blur">
                <MessageCircle className="h-12 w-12 text-primary" />
              </div>
            </div>
            <Badge className="absolute right-4 top-4 bg-primary text-primary-foreground">
              新劇情
            </Badge>
          </div>

          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-2xl text-card-foreground">
                  {storyPlot.title}
                </CardTitle>
                <CardDescription className="mt-2 text-base">
                  {storyPlot.description}
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            {/* Story Info */}
            <div className="mb-6 flex flex-wrap gap-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                <span>約 {storyPlot.estimatedMins} 分鐘</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Users className="h-4 w-4" />
                <span>2 位角色</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <MessageCircle className="h-4 w-4" />
                <span>{storyPlot.phases.length} 個章節</span>
              </div>
            </div>

            {/* Characters Preview */}
            <div className="mb-6 rounded-lg bg-muted/50 p-4">
              <h4 className="mb-3 text-sm font-medium text-foreground">登場角色</h4>
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
                    陳
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">陳副理</p>
                    <p className="text-xs text-muted-foreground">你的主管，說話直接、結果導向</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
                    林
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">小林</p>
                    <p className="text-xs text-muted-foreground">你的同事，能省則省、擅長找理由</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Start Button */}
            <Button
              onClick={startGame}
              size="lg"
              className="w-full gap-2 rounded-full text-base"
            >
              <Play className="h-5 w-5" />
              開始遊戲
            </Button>
          </CardContent>
        </Card>

        {/* How to Play */}
        <div className="mt-8">
          <h3 className="mb-4 text-center text-lg font-semibold text-foreground">如何遊玩</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg bg-card p-4 text-center shadow-sm">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">
                1
              </div>
              <h4 className="mb-1 font-medium text-foreground">閱讀訊息</h4>
              <p className="text-sm text-muted-foreground">
                角色會主動發送訊息給你
              </p>
            </div>
            <div className="rounded-lg bg-card p-4 text-center shadow-sm">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">
                2
              </div>
              <h4 className="mb-1 font-medium text-foreground">做出選擇</h4>
              <p className="text-sm text-muted-foreground">
                你的回覆會影響角色情緒和故事走向
              </p>
            </div>
            <div className="rounded-lg bg-card p-4 text-center shadow-sm">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">
                3
              </div>
              <h4 className="mb-1 font-medium text-foreground">體驗結局</h4>
              <p className="text-sm text-muted-foreground">
                根據你的表現迎來不同結局
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-card py-4 text-center text-sm text-muted-foreground">
        Story Chat Game - 互動劇情體驗
      </footer>
    </div>
  );
}
