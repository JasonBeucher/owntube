import { Feather } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { channelInitial, formatCompactCount } from "@/lib/format";
import { trpcClient } from "@/lib/trpc";
import { errorMessage } from "@/lib/use-query";
import { colors, fontSize, radius, spacing } from "@/theme";

type Comment = {
  commentId: string;
  author: string;
  text: string;
  authorAvatarUrl?: string;
  likeCount?: number;
  publishedText?: string;
  isPinned?: boolean;
};

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; comments: Comment[]; disabled: boolean };

/** Side panel of top comments, opened from the paused player overlay. */
export function PlayerComments({ videoId }: { videoId: string }) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    trpcClient.video.comments
      .query({ videoId, sortBy: "top" })
      .then((result) => {
        if (cancelled) return;
        setState({
          status: "ready",
          comments: result.comments,
          disabled: result.disabled === true,
        });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setState({ status: "error", message: errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Feather name="message-square" size={18} color={colors.brand} />
        <Text style={styles.headerText}>Comments</Text>
      </View>

      {state.status === "loading" ? (
        <ActivityIndicator color={colors.brand} style={styles.centered} />
      ) : state.status === "error" ? (
        <Text style={styles.muted}>{state.message}</Text>
      ) : state.disabled ? (
        <Text style={styles.muted}>Comments are disabled for this video.</Text>
      ) : state.comments.length === 0 ? (
        <Text style={styles.muted}>No comments yet.</Text>
      ) : (
        <FlatList
          data={state.comments}
          keyExtractor={(comment) => comment.commentId}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={Separator}
          renderItem={({ item }) => <CommentRow comment={item} />}
        />
      )}
    </View>
  );
}

function CommentRow({ comment }: { comment: Comment }) {
  const likes = formatCompactCount(comment.likeCount);
  return (
    <View style={styles.comment}>
      {comment.authorAvatarUrl ? (
        <Image
          source={{ uri: comment.authorAvatarUrl }}
          style={styles.avatar}
        />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback]}>
          <Text style={styles.avatarInitial}>
            {channelInitial(comment.author)}
          </Text>
        </View>
      )}
      <View style={styles.commentBody}>
        <Text style={styles.author} numberOfLines={1}>
          {comment.isPinned ? "📌 " : ""}
          {comment.author}
          {comment.publishedText ? ` · ${comment.publishedText}` : ""}
        </Text>
        <Text style={styles.text}>{comment.text}</Text>
        {likes ? <Text style={styles.likes}>{likes} likes</Text> : null}
      </View>
    </View>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  panel: {
    width: 520,
    maxHeight: 460,
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    backgroundColor: colors.cardElevated,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingBottom: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceBorder,
  },
  headerText: {
    color: colors.foreground,
    fontSize: fontSize.md,
    fontWeight: "800",
  },
  centered: { paddingVertical: spacing.lg },
  muted: { color: colors.mutedForeground, fontSize: fontSize.sm },
  comment: { flexDirection: "row", gap: spacing.sm, paddingVertical: 6 },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.avatarFallback,
  },
  avatarFallback: { alignItems: "center", justifyContent: "center" },
  avatarInitial: {
    color: colors.foreground,
    fontSize: fontSize.sm,
    fontWeight: "700",
  },
  commentBody: { flex: 1, minWidth: 0, gap: 2 },
  author: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
  text: { color: colors.foreground, fontSize: fontSize.sm, lineHeight: 19 },
  likes: { color: colors.mutedForeground, fontSize: 12 },
  separator: { height: 1, backgroundColor: colors.surfaceBorder },
});
