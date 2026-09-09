import React from "react";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { create, act, type ReactTestRenderer } from "react-test-renderer";
import {
  VideoFeedProvider,
  useVideoFeed,
  VIDEO_FEED_STORAGE_KEY,
} from "../lib/VideoFeedContext";
import VideoFeedGate from "../components/VideoFeedGate";
import VideoPlayer from "../components/VideoPlayer";

// The Next.js source uses its automatic JSX runtime; tsx also supports this global in tests.
Object.assign(globalThis, { React });
let storage: Map<string, string>;
let events: EventTarget;
let preference: ReturnType<typeof useVideoFeed>;
let tree: ReactTestRenderer | undefined;
let requests: AbortSignal[];
const originalFetch = globalThis.fetch;

beforeEach(() => {
  storage = new Map();
  events = new EventTarget();
  requests = [];
  const local = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  };
  Object.assign(globalThis, { window: events, localStorage: local });
  globalThis.fetch = async (_url, init) => {
    requests.push(init!.signal as AbortSignal);
    return Response.json({
      url: "https://example.invalid/fixture.mp4",
      expiresAt: 9999999999,
    });
  };
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
  globalThis.fetch = originalFetch;
});
function Capture() {
  preference = useVideoFeed();
  return null;
}
async function mount() {
  await act(async () => {
    tree = create(
      <VideoFeedProvider>
        <Capture />
        <VideoFeedGate>
          <VideoPlayer
            segment={{
              fileID: "test-segment",
              start_utc: "2026-09-09T12:00:00Z",
              total_frames: 30,
              fps: 1,
              max_people: 2,
              avg_people: 1,
              overlay_key: "fixture.mp4",
            }}
            tz="UTC"
            onClose={() => {}}
          />
        </VideoFeedGate>
      </VideoFeedProvider>,
    );
  });
}

test("a persisted off preference prevents video mounting and URL requests, including after reload", async () => {
  storage.set(VIDEO_FEED_STORAGE_KEY, "false");
  await mount();
  assert.equal(requests.length, 0);
  assert.equal(tree!.root.findAllByType("video").length, 0);
  assert.match(
    JSON.stringify(tree!.toJSON()),
    /Zero-Day retention enabled - video feed isn't available/,
  );
  await act(async () => tree!.unmount());
  await mount();
  assert.equal(preference.enabled, false);
  assert.equal(requests.length, 0);
});

test("toggle persists, unmounts active playback, aborts its request, and can enable playback again", async () => {
  await mount();
  assert.equal(requests.length, 1);
  assert.equal(tree!.root.findAllByType("video").length, 1);
  await act(async () => preference.setEnabled(false));
  assert.equal(storage.get(VIDEO_FEED_STORAGE_KEY), "false");
  assert.equal(requests[0].aborted, true);
  assert.equal(tree!.root.findAllByType("video").length, 0);
  await act(async () => preference.setEnabled(true));
  assert.equal(storage.get(VIDEO_FEED_STORAGE_KEY), "true");
  assert.equal(requests.length, 2);
  assert.equal(tree!.root.findAllByType("video").length, 1);
});

test("changes in another tab hide active playback", async () => {
  await mount();
  await act(async () => {
    const event = Object.assign(new Event("storage"), {
      storageArea: localStorage,
      key: VIDEO_FEED_STORAGE_KEY,
      newValue: "false",
    });
    events.dispatchEvent(event);
  });
  assert.equal(preference.enabled, false);
  assert.equal(tree!.root.findAllByType("video").length, 0);
});

test("unavailable browser storage does not break the switch", async () => {
  Object.assign(globalThis, {
    localStorage: {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    },
  });
  await mount();
  assert.equal(preference.saved, false);
  await act(async () => preference.setEnabled(false));
  assert.equal(preference.enabled, false);
  assert.equal(tree!.root.findAllByType("video").length, 0);
});
