"use client";

import { useGame } from "@/lib/game-context";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Users } from "lucide-react";
import { CharacterAvatar } from "@/components/chat/CharacterAvatar";
import { characters } from "@/lib/story-data";

export function ChatList() {
  const { gameState, setActiveChat } = useGame();

  if (!gameState) return null;

  const sortedRooms = [...gameState.chatRooms].sort((a, b) => {
    const timeA = a.lastMessageTime?.getTime() || 0;
    const timeB = b.lastMessageTime?.getTime() || 0;
    return timeB - timeA;
  });

  return (
    <div className="flex h-full flex-col bg-sidebar">
      {/* Header */}
      <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-4">
        <h2 className="text-lg font-semibold text-sidebar-foreground">聊天</h2>
      </div>

      {/* Chat List */}
      <ScrollArea className="flex-1">
        <div className="flex flex-col">
          {sortedRooms.map((room) => {
            const isActive = gameState.activeChatId === room.id;
            
            return (
              <button
                key={room.id}
                onClick={() => setActiveChat(room.id)}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-sidebar-accent",
                  isActive && "bg-sidebar-accent"
                )}
              >
                {/* Avatar */}
                <div className="relative">
                  {room.type === 'dm' && room.characterId ? (() => {
                    const char = characters[room.characterId];
                    const charState = gameState.session.characterStates[room.characterId];
                    return (
                      <CharacterAvatar
                        avatarUrl={char?.profile.avatarUrl}
                        name={char?.profile.name ?? room.name}
                        pad={charState?.pad ?? char?.padConfig.initial}
                        avatarExpressions={char?.profile.avatarExpressions}
                        className="h-12 w-12"
                        fallbackClassName="bg-muted-foreground text-primary-foreground"
                      />
                    );
                  })() : (
                    <Avatar className="h-12 w-12">
                      <AvatarImage src={room.avatarUrl} alt={room.name} />
                      <AvatarFallback className="bg-primary text-primary-foreground">
                        <Users className="h-5 w-5" />
                      </AvatarFallback>
                    </Avatar>
                  )}
                  {room.unreadCount > 0 && (
                    <Badge
                      className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs text-destructive-foreground"
                    >
                      {room.unreadCount}
                    </Badge>
                  )}
                  {room.isOnline !== undefined && room.unreadCount === 0 && (
                    <span className={cn(
                      "absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-background",
                      room.isOnline ? "bg-green-500" : "bg-gray-400"
                    )} />
                  )}
                </div>

                {/* Content */}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-center justify-between">
                    <span className={cn(
                      "truncate font-medium",
                      room.unreadCount > 0 ? "text-sidebar-foreground" : "text-sidebar-foreground"
                    )}>
                      {room.name}
                    </span>
                    {room.lastMessageTime && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {formatTime(room.lastMessageTime)}
                      </span>
                    )}
                  </div>
                  {room.lastMessage && (
                    <p className={cn(
                      "truncate text-sm",
                      room.unreadCount > 0 ? "font-medium text-sidebar-foreground" : "text-muted-foreground"
                    )}>
                      {room.lastMessage}
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

function formatTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  if (diff < 60000) return "剛才";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分鐘前`;
  
  return date.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
}
