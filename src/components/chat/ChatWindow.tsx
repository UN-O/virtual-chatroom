"use client";

import { useState, useRef, useEffect } from "react";
import { useGame } from "@/lib/game-context";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ArrowLeft, Send, Users, User, MoreVertical } from "lucide-react";
import { characters } from "@/lib/story-data";
export function ChatWindow() {
  const { gameState, sendMessage, setActiveChat, getCharacterName } = useGame();
  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeChatRoom = gameState?.chatRooms.find(
    (room) => room.id === gameState.activeChatId
  );

  const messages = gameState?.session.messages.filter(
    (msg) => msg.chatId === gameState.activeChatId
  ) || [];

  // Index of the last player message that has been read by at least one character
  const lastReadIdx = messages.reduce(
    (idx, m, i) => (m.senderType === 'player' && m.readBy && m.readBy.length > 0 ? i : idx),
    -1
  );

  // Auto scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const handleSend = async () => {
    if (!inputValue.trim() || !gameState?.activeChatId) return;
    
    const message = inputValue.trim();
    setInputValue("");
    await sendMessage(gameState.activeChatId, message);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!activeChatRoom) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-background">
        <div className="text-center">
          <div className="mb-4 rounded-full bg-muted p-6">
            <Users className="h-12 w-12 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-medium text-foreground">選擇一個對話</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            從左側選擇一個聊天室開始對話
          </p>
        </div>
      </div>
    );
  }

  const getAvatarForSender = (senderId: string | null) => {
    if (!senderId) return null;
    const char = characters[senderId];
    return char ? char.profile.avatarUrl : null;
  };

  const getSenderInitial = (senderId: string | null) => {
    if (!senderId) return "你";
    const char = characters[senderId];
    return char ? char.profile.name[0] : "?";
  };

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex h-14 items-center gap-3 border-b border-border bg-[var(--chat-header)] px-3 text-[var(--chat-header-foreground)]">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-inherit hover:bg-white/10 md:hidden"
          onClick={() => setActiveChat(null)}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        
        <Avatar className="h-9 w-9">
          <AvatarImage src={activeChatRoom.avatarUrl} alt={activeChatRoom.name} />
          <AvatarFallback className="bg-white/20 text-inherit">
            {activeChatRoom.type === 'group' ? (
              <Users className="h-4 w-4" />
            ) : (
              <User className="h-4 w-4" />
            )}
          </AvatarFallback>
        </Avatar>

        <div className="flex flex-1 flex-col">
          <span className="font-medium">{activeChatRoom.name}</span>
          {activeChatRoom.type === 'group' && (
            <span className="text-xs opacity-80">3 位成員</span>
          )}
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-inherit hover:bg-white/10"
        >
          <MoreVertical className="h-5 w-5" />
        </Button>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 px-4 py-3">
        <div className="flex flex-col gap-3">
          {messages.map((message, index) => {
            const isPlayer = message.senderType === 'player';
            const showAvatar = !isPlayer && (
              index === 0 ||
              messages[index - 1]?.senderId !== message.senderId
            );
            const senderName = message.senderId ? getCharacterName(message.senderId) : null;
            const showName = !isPlayer && activeChatRoom.type === 'group' && showAvatar;

            // 已讀：只在最後一則有 readBy 的玩家訊息上顯示
            const showRead = isPlayer && index === lastReadIdx;
            const readCount = showRead ? (message.readBy?.length ?? 0) : 0;

            return (
              <div
                key={message.id}
                className={cn(
                  "flex items-end gap-2",
                  isPlayer ? "flex-row-reverse" : "flex-row"
                )}
              >
                {/* Avatar */}
                {!isPlayer && (
                  <div className="w-8 shrink-0">
                    {showAvatar && (
                      <Avatar className="h-8 w-8">
                        <AvatarImage
                          src={getAvatarForSender(message.senderId) || undefined}
                          alt={senderName || "Character"}
                        />
                        <AvatarFallback className="bg-muted text-muted-foreground text-xs">
                          {getSenderInitial(message.senderId)}
                        </AvatarFallback>
                      </Avatar>
                    )}
                  </div>
                )}

                {/* Message Bubble */}
                <div
                  className={cn(
                    "flex max-w-[75%] flex-col gap-1",
                    isPlayer ? "items-end" : "items-start"
                  )}
                >
                  {showName && senderName && (
                    <span className="px-1 text-xs text-muted-foreground">
                      {senderName}
                    </span>
                  )}
                  <div
                    className={cn(
                      "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                      isPlayer
                        ? "rounded-br-md bg-[var(--chat-bubble-self)] text-[var(--chat-bubble-self-foreground)]"
                        : "rounded-bl-md bg-[var(--chat-bubble-other)] text-[var(--chat-bubble-other-foreground)] shadow-sm"
                    )}
                  >
                    {message.content}
                  </div>
                  <div className="flex items-center gap-1 px-1">
                    {showRead && (
                      <span className="text-[10px] text-muted-foreground">
                        {activeChatRoom.type === 'group' && readCount > 1
                          ? `已讀 ${readCount}`
                          : '已讀'}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      {formatMessageTime(message.createdAt)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
          
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="border-t border-border bg-card p-3">
        <div className="flex items-center gap-2">
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="輸入訊息..."
            className="flex-1 rounded-full border-input bg-secondary"
          />
          <Button
            onClick={handleSend}
            disabled={!inputValue.trim() || gameState?.isLoading}
            size="icon"
            className="h-10 w-10 shrink-0 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Send className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function formatMessageTime(date: Date): string {
  return date.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
}
