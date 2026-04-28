"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/trpc/react";

type InteractionButtonsProps = {
  videoId: string;
  channelId?: string;
  isAuthenticated: boolean;
};

export function InteractionButtons({
  videoId,
  channelId,
  isAuthenticated,
}: InteractionButtonsProps) {
  const utils = trpc.useUtils();
  const stateQuery = trpc.interactions.state.useQuery(
    { videoId },
    { enabled: isAuthenticated },
  );
  const setMutation = trpc.interactions.set.useMutation({
    onSuccess: async () => {
      await utils.interactions.state.invalidate({ videoId });
    },
  });

  const state = useMemo(
    () => stateQuery.data ?? { like: false, dislike: false, save: false },
    [stateQuery.data],
  );

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant={state.like ? "default" : "outline"}
        disabled={!isAuthenticated}
        onClick={() =>
          setMutation.mutate({
            videoId,
            channelId,
            type: "like",
            active: !state.like,
          })
        }
      >
        Like
      </Button>
      <Button
        variant={state.dislike ? "default" : "outline"}
        disabled={!isAuthenticated}
        onClick={() =>
          setMutation.mutate({
            videoId,
            channelId,
            type: "dislike",
            active: !state.dislike,
          })
        }
      >
        Dislike
      </Button>
      <Button
        variant={state.save ? "default" : "outline"}
        disabled={!isAuthenticated}
        onClick={() =>
          setMutation.mutate({
            videoId,
            channelId,
            type: "save",
            active: !state.save,
          })
        }
      >
        Save
      </Button>
    </div>
  );
}
