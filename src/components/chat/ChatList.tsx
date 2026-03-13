"use client";

import { useGame } from "@/lib/game-context";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Users, User } from "lucide-react";

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
                  <Avatar className="h-12 w-12">
                    <AvatarImage src={room.avatarUrl} alt={room.name} />
                    <AvatarFallback className={cn(
                      "text-primary-foreground",
                      room.type === 'group' ? "bg-primary" : "bg-muted-foreground"
                    )}>
                      {room.type === 'group' ? (
                        <Users className="h-5 w-5" />
                      ) : (
                        <User className="h-5 w-5" />
                      )}
                    </AvatarFallback>
                  </Avatar>
                  {room.unreadCount > 0 && (
                    <Badge 
                      className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs text-destructive-foreground"
                    >
                      {room.unreadCount}
                    </Badge>
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
