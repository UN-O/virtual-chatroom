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

// Typing indicator component
function TypingIndicator({ characterName, avatarUrl }: { characterName: string; avatarUrl?: string }) {
  return (
    <div className="flex items-end gap-2">
      <div className="w-8 shrink-0">
        <Avatar className="h-8 w-8">
          <AvatarImage src={avatarUrl} alt={characterName} />
          <AvatarFallback className="bg-muted text-muted-foreground text-xs">
            {characterName[0]}
          </AvatarFallback>
        </Avatar>
      </div>
      <div className="flex flex-col gap-1 items-start">
        <span className="px-1 text-xs text-muted-foreground">{characterName}</span>
        <div className="rounded-2xl rounded-bl-md bg-[var(--chat-bubble-other)] px-4 py-3 shadow-sm">
          <div className="flex gap-1">
            <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/50" style={{ animationDelay: "0ms" }} />
            <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/50" style={{ animationDelay: "150ms" }} />
            <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/50" style={{ animationDelay: "300ms" }} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ChatWindow() {
  const { gameState, sendMessage, setActiveChat, getCharacterName, getTypingCharacters } = useGame();
  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeChatRoom = gameState?.chatRooms.find(
    (room) => room.id === gameState.activeChatId
  );

  const messages = gameState?.session.messages.filter(
    (msg) => msg.chatId === gameState.activeChatId
  ) || [];

  // Get typing characters for current chat
  const typingCharacterIds = gameState?.activeChatId 
    ? getTypingCharacters(gameState.activeChatId) 
    : [];

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

  const getAvatarForSender = (senderId: string | null, expressionKey?: string) => {
    if (!senderId) return null;
    const char = characters[senderId];
    if (!char) return null;
    const key = expressionKey || 'neutral';
    return char.profile.avatarExpressions[key] || char.profile.avatarUrl;
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
                          src={getAvatarForSender(message.senderId, message.expressionKey) || undefined}
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
                  <span className="px-1 text-[10px] text-muted-foreground">
                    {message.virtualTimeLabel || formatMessageTime(message.createdAt)}
                  </span>
                </div>
              </div>
            );
          })}
          
          {/* Typing indicators */}
          {typingCharacterIds.map(charId => {
            const char = characters[charId];
            if (!char) return null;
            return (
              <TypingIndicator 
                key={`typing_${charId}`}
                characterName={char.profile.name}
                avatarUrl={char.profile.avatarUrl}
              />
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
            disabled={!inputValue.trim()}
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
