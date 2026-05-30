"use client";

import { useEffect, useState } from "react";
import {
  gradientForChannelId,
  initialsFromLabel,
} from "@/lib/channel-avatar";
import { toBrowserChannelAvatarUrl } from "@/lib/channel-avatar-proxy";

type ChannelAvatarCircleProps = {
  imageUrl?: string;
  /** Used for initials and gradient when there is no image or it fails to load. */
  label: string;
  size?: "sm" | "md" | "lg";
};

export function ChannelAvatarCircle({
  imageUrl,
  label,
  size = "md",
}: ChannelAvatarCircleProps) {
  const [failed, setFailed] = useState(false);
  const resolvedImageUrl = toBrowserChannelAvatarUrl(imageUrl);
  useEffect(() => {
    setFailed(false);
  }, [resolvedImageUrl]);
  const initials = initialsFromLabel(label);
  const avatarBg = gradientForChannelId(label);
  const sizeClass =
    size === "sm"
      ? "h-6 w-6 text-[10px]"
      : size === "lg"
        ? "h-10 w-10 text-sm"
        : "h-9 w-9 text-xs";
  const showImg = Boolean(resolvedImageUrl) && !failed;

  return (
    <span
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-white ${sizeClass}`}
      style={showImg ? undefined : { background: avatarBg }}
      aria-hidden
    >
      {showImg ? (
        // biome-ignore lint/performance/noImgElement: upstream channel avatars
        <img
          src={resolvedImageUrl}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        initials
      )}
    </span>
  );
}
