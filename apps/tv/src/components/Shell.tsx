import type { ComponentRef, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BackHandler,
  type StyleProp,
  StyleSheet,
  TVFocusGuideView,
  View,
  type ViewStyle,
} from "react-native";
import { RAIL_WIDTH, type Section, Sidebar } from "@/components/Sidebar";
import type { Nav } from "@/lib/navigation";
import { ChannelScreen } from "@/screens/ChannelScreen";
import { HistoryScreen } from "@/screens/HistoryScreen";
import { HomeScreen } from "@/screens/HomeScreen";
import { LibraryScreen } from "@/screens/LibraryScreen";
import { SearchScreen } from "@/screens/SearchScreen";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { ShortsScreen } from "@/screens/ShortsScreen";
import { SubscriptionsScreen } from "@/screens/SubscriptionsScreen";
import { WatchScreen } from "@/screens/WatchScreen";
import { colors, spacing } from "@/theme";

/**
 * 10-foot app shell: a left nav over section screens, plus a small route stack
 * for watch/channel overlays. No navigation library — a section is the base and
 * watch/channel push onto a stack that remote Back pops (exits at the root).
 *
 * Every screen the user has visited stays **mounted**; only the active one is
 * displayed. Unmounting on navigation is what made the app feel broken: the
 * feed refetched from page 1, scroll jumped to the top and focus reset to the
 * hero every single time the user came back from a video.
 */
type Route =
  | { name: "watch"; key: string; videoId: string; resumeSeconds?: number }
  | { name: "channel"; key: string; channelId: string };

let routeSequence = 0;

const nextRouteKey = () => `route-${++routeSequence}`;

export function Shell({ onSignOut }: { onSignOut: () => void }) {
  const [section, setSection] = useState<Section>("home");
  // Sections mount on first visit and stay mounted from then on.
  const [mountedSections, setMountedSections] = useState<Section[]>(["home"]);
  const [stack, setStack] = useState<Route[]>([]);
  const top = stack[stack.length - 1];

  // The player stays mounted while a channel page is pushed on top of it, so
  // returning to it resumes playback instead of restarting the video.
  const watchRoute = [...stack]
    .reverse()
    .find((route) => route.name === "watch");
  const topChannelRoute = [...stack]
    .reverse()
    .find((route) => route.name === "channel");
  const watchActive = top?.name === "watch";
  const channelActive = topChannelRoute !== undefined;

  const selectSection = useCallback((next: Section) => {
    // Picking a nav item leaves any overlay — otherwise the channel route
    // stayed on top and the tap appeared to do nothing.
    setStack([]);
    setSection(next);
    setMountedSections((mounted) =>
      mounted.includes(next) ? mounted : [...mounted, next],
    );
  }, []);

  const nav: Nav = useMemo(
    () => ({
      openVideo: (videoId, resumeSeconds) =>
        setStack((s) => [
          ...s,
          { name: "watch", key: nextRouteKey(), videoId, resumeSeconds },
        ]),
      openChannel: (channelId) =>
        setStack((s) => [
          ...s,
          { name: "channel", key: nextRouteKey(), channelId },
        ]),
    }),
    [],
  );

  const pop = useCallback(() => setStack((s) => s.slice(0, -1)), []);

  // Remote Back pops the overlay stack first; at the shell root it exits.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (stack.length > 0) {
        pop();
        return true;
      }
      BackHandler.exitApp();
      return true;
    });
    return () => sub.remove();
  }, [stack.length, pop]);

  return (
    <View style={styles.shell}>
      {/* The shell is deliberately *not* hidden while the player is up: the
          player covers it opaquely, and toggling `display` forces a re-layout
          that resets every horizontal shelf back to offset 0. Blocking the
          subtree from the focus graph is all that's actually needed. */}
      <View style={styles.base} tvFocusable={!watchActive}>
        {/* Content reserves the collapsed rail as a left margin; the sidebar
            overlays the content (absolute) and expands rightward over it. */}
        <View style={styles.content}>
          {mountedSections.map((key) => {
            const visible = key === section && !channelActive;
            return (
              <ScreenLayer
                key={key}
                visible={visible}
                focused={visible && !watchActive}
              >
                {renderSection(key, nav, onSignOut)}
              </ScreenLayer>
            );
          })}
          {stack.map((route) =>
            route.name === "channel" ? (
              <ScreenLayer
                key={route.key}
                visible={route.key === topChannelRoute?.key}
                focused={route.key === topChannelRoute?.key && !watchActive}
              >
                <ChannelScreen channelId={route.channelId} nav={nav} />
              </ScreenLayer>
            ) : null,
          )}
        </View>
        <Sidebar active={section} onSelect={selectSection} />
      </View>

      {watchRoute?.name === "watch" ? (
        <ScreenLayer
          visible={watchActive}
          focused={watchActive}
          style={styles.watchLayer}
        >
          <WatchScreen
            key={watchRoute.key}
            videoId={watchRoute.videoId}
            resumeSeconds={watchRoute.resumeSeconds}
            active={watchActive}
            onOpenVideo={nav.openVideo}
            onOpenChannel={nav.openChannel}
            onBack={pop}
          />
        </ScreenLayer>
      ) : null}
    </View>
  );
}

function renderSection(
  section: Section,
  nav: Nav,
  onSignOut: () => void,
): ReactNode {
  switch (section) {
    case "home":
      return <HomeScreen nav={nav} />;
    case "search":
      return <SearchScreen nav={nav} />;
    case "shorts":
      return <ShortsScreen />;
    case "subscriptions":
      return <SubscriptionsScreen nav={nav} />;
    case "library":
      return <LibraryScreen nav={nav} />;
    case "history":
      return <HistoryScreen nav={nav} />;
    case "settings":
      return <SettingsScreen onSignOut={onSignOut} />;
  }
}

/**
 * A screen kept mounted in the background. `enabled` toggles `display`, and
 * `focusable` drops the whole subtree out of the D-pad focus graph
 * (`FOCUS_BLOCK_DESCENDANTS` on Android TV) so a hidden screen can never steal
 * focus. `autoFocus` restores whatever the user last had focused in this layer
 * when it comes back — that is the focus memory, no bookkeeping of our own.
 */
function ScreenLayer({
  visible,
  focused,
  style,
  children,
}: {
  /** Laid out and drawn. Hiding forces a re-layout, so keep it true when the layer is merely covered. */
  visible: boolean;
  /** Allowed to hold D-pad focus, and takes it back when this turns true. */
  focused: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const guideRef = useRef<ComponentRef<typeof TVFocusGuideView>>(null);

  // Re-showing a layer does not move Android's focus by itself — it only stops
  // blocking descendants, leaving nothing focused. Asking the guide to take
  // focus triggers its redirect to the child the user last had. Delayed a tick
  // so the wrapper's native `display`/`tvFocusable` props land first.
  useEffect(() => {
    if (!focused) return;
    const timer = setTimeout(() => guideRef.current?.requestTVFocus?.(), 0);
    return () => clearTimeout(timer);
  }, [focused]);

  // Visibility lives on the wrapper, never on the guide: `setAutoFocusTV`
  // clears the guide's remembered child every time its props are re-applied,
  // so toggling anything on the guide itself would wipe the focus memory that
  // is the whole point of it. No `tvFocusable` here either — a `display: none`
  // subtree is already skipped by the focus finder, and marking the wrapper
  // focusable makes Android draw its default highlight around the whole screen.
  return (
    <View style={[style ?? styles.layer, !visible && styles.hidden]}>
      <TVFocusGuideView ref={guideRef} autoFocus style={styles.layer}>
        {children}
      </TVFocusGuideView>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.background },
  base: { flex: 1 },
  hidden: { display: "none" },
  layer: { flex: 1 },
  content: {
    flex: 1,
    marginLeft: RAIL_WIDTH,
    paddingVertical: spacing.screen,
    paddingRight: spacing.screen,
    paddingLeft: spacing.lg,
  },
  // The player covers the sidebar too, so it sits above the base layer.
  watchLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
    backgroundColor: colors.videoBackground,
  },
});
