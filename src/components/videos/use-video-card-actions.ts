"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { trpc } from "@/trpc/react";

export type VideoCardActionsView = "main" | "playlist" | "create-playlist";

export function useVideoCardActions({
  videoId,
  channelId,
  channelName,
  loadPlaylists = false,
}: {
  videoId: string;
  channelId?: string;
  channelName?: string;
  loadPlaylists?: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<VideoCardActionsView>("main");
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [playlistOpen, setPlaylistOpen] = useState(false);

  const utils = trpc.useUtils();
  const interactionState = trpc.interactions.state.useQuery({ videoId });
  const playlists = trpc.playlists.list.useQuery(undefined, {
    enabled: loadPlaylists || (playlistOpen && view !== "main"),
  });
  const settings = trpc.settings.get.useQuery(undefined, {
    enabled: Boolean(channelId),
  });

  const setInteraction = trpc.interactions.set.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.interactions.state.invalidate({ videoId }),
        utils.feed.home.invalidate(),
        utils.video.related.invalidate(),
        utils.shorts.feed.invalidate(),
      ]);
    },
  });
  const addToPlaylist = trpc.playlists.addItem.useMutation({
    onSuccess: async () => {
      await utils.playlists.list.invalidate();
    },
  });
  const createPlaylist = trpc.playlists.create.useMutation({
    onSuccess: async () => {
      await utils.playlists.list.invalidate();
    },
  });
  const blockChannel = trpc.interactions.blockRecommendationChannel.useMutation(
    {
      onSuccess: async () => {
        await Promise.all([
          utils.settings.get.invalidate(),
          utils.feed.home.invalidate(),
          utils.video.related.invalidate(),
          utils.shorts.feed.invalidate(),
        ]);
      },
    },
  );

  const liked = interactionState.data?.like ?? false;
  const disliked = interactionState.data?.dislike ?? false;
  const channelBlocked =
    channelId != null &&
    (settings.data?.blockedRecommendationChannels.includes(channelId) ?? false);
  const pending =
    setInteraction.isPending ||
    addToPlaylist.isPending ||
    createPlaylist.isPending ||
    blockChannel.isPending;

  useEffect(() => {
    if (!feedback) return;
    const t = window.setTimeout(() => setFeedback(null), 2200);
    return () => window.clearTimeout(t);
  }, [feedback]);

  const redirectToLogin = () => {
    router.push(
      `/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`,
    );
  };

  const runAuthed = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      const code =
        err &&
        typeof err === "object" &&
        "data" in err &&
        err.data &&
        typeof err.data === "object" &&
        "code" in err.data
          ? String(err.data.code)
          : "";
      if (code === "UNAUTHORIZED") {
        redirectToLogin();
        return;
      }
      throw err;
    }
  };

  const closePanels = () => {
    setPlaylistOpen(false);
    setView("main");
    setFeedback(null);
  };

  const toggleLike = async () => {
    const next = !liked;
    await runAuthed(async () => {
      await setInteraction.mutateAsync({
        videoId,
        channelId,
        type: "like",
        active: next,
      });
      if (next && disliked) {
        await setInteraction.mutateAsync({
          videoId,
          channelId,
          type: "dislike",
          active: false,
        });
      }
      setFeedback(next ? "Ajouté aux contenus aimés" : "Like retiré");
    });
  };

  const toggleDislike = async () => {
    const next = !disliked;
    await runAuthed(async () => {
      await setInteraction.mutateAsync({
        videoId,
        channelId,
        type: "dislike",
        active: next,
      });
      if (next && liked) {
        await setInteraction.mutateAsync({
          videoId,
          channelId,
          type: "like",
          active: false,
        });
      }
      setFeedback(next ? "Signalé comme non aimé" : "Dislike retiré");
    });
  };

  const addVideoToPlaylist = async (playlistId: number) => {
    await runAuthed(async () => {
      await addToPlaylist.mutateAsync({ playlistId, videoId, channelId });
      setFeedback("Ajouté à la playlist");
      closePanels();
    });
  };

  const submitNewPlaylist = async () => {
    const name = newPlaylistName.trim();
    if (!name) return;
    await runAuthed(async () => {
      const created = await createPlaylist.mutateAsync({ name });
      await addToPlaylist.mutateAsync({
        playlistId: created.id,
        videoId,
        channelId,
      });
      setNewPlaylistName("");
      setFeedback("Playlist créée et vidéo ajoutée");
      closePanels();
    });
  };

  const blockRecommendationChannel = async () => {
    if (!channelId) return;
    await runAuthed(async () => {
      await blockChannel.mutateAsync({ channelId });
      setFeedback(
        channelName
          ? `« ${channelName} » exclue des recommandations`
          : "Chaîne exclue des recommandations",
      );
      closePanels();
    });
  };

  return {
    liked,
    disliked,
    channelBlocked,
    pending,
    feedback,
    view,
    setView,
    newPlaylistName,
    setNewPlaylistName,
    playlistOpen,
    setPlaylistOpen,
    playlists,
    toggleLike,
    toggleDislike,
    addVideoToPlaylist,
    submitNewPlaylist,
    blockRecommendationChannel,
    closePanels,
  };
}
