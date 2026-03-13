"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { getExpressionFromPAD } from "@/lib/engine/pad";
import type { PAD } from "@/lib/types";

interface CharacterAvatarProps {
  avatarUrl?: string;
  name: string;
  pad?: PAD;
  expressionKey?: string;
  avatarExpressions?: Record<string, string>;
  className?: string;
  fallbackClassName?: string;
}

/**
 * CharacterAvatar
 *
 * Renders a character avatar with optional expression support.
 *
 * Resolution order for the image URL:
 *  1. `expressionKey` is provided AND `avatarExpressions[expressionKey]` exists → use it
 *  2. `pad` is provided AND `avatarExpressions` exists → compute expression from PAD and use if key exists
 *  3. Fallback to `avatarUrl`
 */
export function CharacterAvatar({
  avatarUrl,
  name,
  pad,
  expressionKey,
  avatarExpressions,
  className,
  fallbackClassName,
}: CharacterAvatarProps) {
  let resolvedSrc: string | undefined = avatarUrl;

  if (expressionKey && avatarExpressions?.[expressionKey]) {
    resolvedSrc = avatarExpressions[expressionKey];
  } else if (pad && avatarExpressions) {
    const computedKey = getExpressionFromPAD(pad);
    if (avatarExpressions[computedKey]) {
      resolvedSrc = avatarExpressions[computedKey];
    }
  }

  const fallbackChar = name.length > 0 ? name[0] : "?";

  return (
    <Avatar className={className}>
      <AvatarImage src={resolvedSrc} alt={name} />
      <AvatarFallback className={fallbackClassName}>
        {fallbackChar}
      </AvatarFallback>
    </Avatar>
  );
}
