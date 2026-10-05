"use client";

import {
  autoInk,
  BOT_AVATAR_OVERSCAN,
  BOT_AVATAR_RISE,
  type BotAvatarDrawConfig,
  type BotAvatarPose,
  BotAvatarSim,
  type BotAvatarType,
  botAvatarParts,
  botAvatarPresets,
  botAvatarShapes,
  drawBotAvatarFrame,
  BotAvatar as NativeBotAvatar,
  restPose,
  shade,
} from "bot-avatars";
import {
  type ComponentPropsWithoutRef,
  forwardRef,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import { useMediaQuery } from "#hooks/use-media-query";

export type { BotAvatarType } from "bot-avatars";
export type BotAvatarMaterial = "fabric" | "plastic";

// The stock renderer blends lighting during motion. Keep pristine still frames
// in their own contexts, shared across identical avatars and bounded in memory.
const restingFrames = new Map<string, HTMLCanvasElement>();
function restingFrame(
  key: string,
  size: number,
  pose: BotAvatarPose,
  config: BotAvatarDrawConfig
) {
  const cached = restingFrames.get(key);
  if (cached) {
    return cached;
  }
  const canvas = document.createElement("canvas");
  const dpr = config.dpr ?? 1;
  canvas.width = canvas.height = Math.round(size * BOT_AVATAR_OVERSCAN * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return undefined;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawBotAvatarFrame(ctx, size, pose, { ...config, still: true });
  if (restingFrames.size >= 64) {
    restingFrames.clear();
  }
  restingFrames.set(key, canvas);
  return canvas;
}

type BotAvatarProps = Omit<ComponentPropsWithoutRef<"canvas">, "type"> & {
  type: BotAvatarType;
  size: number;
  working?: boolean;
  motionEnabled?: boolean;
  shading?: BotAvatarMaterial;
  followPointer?: boolean;
  /** Keep the library's existing full interaction in the avatar editor. */
  preview?: boolean;
};

export const BotAvatar = forwardRef<HTMLCanvasElement, BotAvatarProps>(
  function BotAvatar(
    {
      preview,
      working = false,
      motionEnabled = true,
      shading = "fabric",
      followPointer,
      ...props
    },
    ref
  ) {
    const prefersReducedMotion = useMediaQuery(
      "(prefers-reduced-motion: reduce)"
    );
    const reducedMotion = prefersReducedMotion || !motionEnabled;
    if (preview) {
      return (
        <NativeBotAvatar
          {...props}
          brightness={1}
          data-bot-material={shading}
          interactive={!reducedMotion}
          jumpEvery={working ? 8 : 0}
          key={`${working}:${reducedMotion}`}
          paused={reducedMotion}
          ref={ref}
          saturation={1.5}
          shading={shading}
          state={working ? "working" : "default"}
        />
      );
    }
    return (
      <InteractiveBotAvatar
        {...props}
        followPointer={followPointer}
        reducedMotion={reducedMotion}
        ref={ref}
        shading={shading}
        working={working}
      />
    );
  }
);

const InteractiveBotAvatar = forwardRef<
  HTMLCanvasElement,
  BotAvatarProps & { reducedMotion: boolean }
>(function InteractiveBotAvatar(
  {
    type,
    size,
    working = false,
    followPointer = false,
    reducedMotion,
    shading = "fabric",
    style,
    ...props
  },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handlers = useRef<{
    click?: () => void;
    pointer?: (x: number, y: number) => void;
    leave?: () => void;
  }>({});
  const id = useId();
  useImperativeHandle(ref, () => canvasRef.current as HTMLCanvasElement, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!(canvas && ctx)) {
      return;
    }
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = canvas.height = Math.round(size * BOT_AVATAR_OVERSCAN * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const preset = botAvatarPresets[type];
    const color = shade(preset.color, 0, 0.25);
    const config: BotAvatarDrawConfig = {
      ...preset,
      path: new Path2D(botAvatarShapes[type]),
      parts: botAvatarParts[type]
        ? new Path2D(botAvatarParts[type])
        : undefined,
      color,
      ink: autoInk(color),
      // Let the renderer own each material's lighting defaults. Keep the same
      // palette in both rendering paths so a preview matches the saved avatar.
      shading,
      typeKey: type,
      dpr,
    };
    const state = working ? "working" : "default";
    const stillFrame = restingFrame(
      `${type}:${size}:${dpr}:${state}:${shading}`,
      size,
      restPose(state),
      config
    );
    const seed =
      [...id].reduce((sum, char) => sum + (char.codePointAt(0) ?? 0), 0) / 1000;
    const createSimulation = () => {
      const simulation = new BotAvatarSim(seed, state);
      simulation.setTurn(0);
      // A small, single hop rather than the preview's full spin.
      simulation.setJump({
        every: 0,
        height: 14,
        time: 0.2,
        stretch: 0.35,
        squash: 0.45,
        clickSquashTime: 0.05,
        groundTime: 0,
        riseTime: 0.06,
        spin: 0,
        lean: 0,
      });
      return simulation;
    };
    let sim = createSimulation();
    let frame = 0;
    let previous = 0;
    let clickTime = 0;
    let following = false;
    let settling = 0;
    let visible = true;
    let observer: IntersectionObserver | undefined;
    const paint = (pose: BotAvatarPose, still: boolean) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawBotAvatarFrame(ctx, size, pose, { ...config, still });
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      previous = 0;
      observer?.disconnect();
      observer = undefined;
      // A disconnected observer's last result cannot veto a later user click.
      visible = true;
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
    const rest = () => {
      stop();
      suspend();
    };
    const suspend = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      previous = 0;
      clickTime = 0;
      settling = 0;
      following = false;
      sim = createSimulation();
      // The library blends its lighting between frames. Restore the captured
      // rest frame so stopping cannot freeze that blend halfway through.
      if (stillFrame) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(stillFrame, 0, 0);
      } else {
        paint(restPose(state), true);
      }
    };
    const tick = (now: number) => {
      frame = 0;
      const delta = previous ? Math.min((now - previous) / 1000, 0.05) : 0;
      previous = now;
      clickTime = Math.max(0, clickTime - delta);
      settling = Math.max(0, settling - delta);
      if (!(working || clickTime || following || settling)) {
        rest();
        return;
      }
      sim.update(delta);
      paint(sim.pose, false);
      frame = requestAnimationFrame(tick);
    };
    const visibilityChanged = () => {
      if (document.hidden || !visible) {
        if (working) {
          suspend();
        } else {
          rest();
        }
      } else if (working) {
        start();
      } else {
        rest();
      }
    };
    const start = () => {
      if (reducedMotion || document.hidden || !visible || frame) {
        return;
      }
      if (!observer) {
        observer = new IntersectionObserver(([entry]) => {
          visible = entry?.isIntersecting ?? false;
          if (!visible) {
            // Only ongoing work needs to resume when it becomes visible.
            if (working) {
              suspend();
            } else {
              rest();
            }
          } else if (working) {
            start();
          }
        });
        observer.observe(canvas);
        document.addEventListener("visibilitychange", visibilityChanged);
      }
      if (!frame) {
        frame = requestAnimationFrame(tick);
      }
    };
    handlers.current = {
      click: () => {
        if (reducedMotion || clickTime || document.hidden) {
          return;
        }
        sim.poke();
        // Covers the public jump timing through its final settling frame.
        clickTime = 0.4;
        start();
      },
      pointer: (x, y) => {
        if (
          !(
            followPointer &&
            !reducedMotion &&
            matchMedia("(hover: hover) and (pointer: fine)").matches
          )
        ) {
          return;
        }
        const rect = canvas.getBoundingClientRect();
        const nx = (x - rect.left - rect.width / 2) / size;
        const ny =
          (y - rect.top - rect.height / 2 - size * BOT_AVATAR_RISE) / size;
        const distance = Math.max(1, Math.hypot(nx, ny));
        sim.setPointer(nx / distance, ny / distance, 1);
        following = true;
        start();
      },
      leave: () => {
        if (following) {
          following = false;
          sim.setPointer(0, 0, 0);
          settling = 0.25;
          start();
        }
      },
    };
    suspend();
    if (working) {
      start();
    }
    return () => {
      stop();
      handlers.current = {};
    };
  }, [followPointer, id, reducedMotion, shading, size, type, working]);

  const margin = (BOT_AVATAR_OVERSCAN - 1) / 2;
  return (
    <canvas
      {...props}
      data-bot-avatar={type}
      data-bot-material={shading}
      data-state={working ? "working" : "default"}
      onClick={(event) => {
        handlers.current.click?.();
        props.onClick?.(event);
      }}
      onPointerLeave={(event) => {
        handlers.current.leave?.();
        props.onPointerLeave?.(event);
      }}
      onPointerMove={(event) => {
        if (event.pointerType === "mouse") {
          handlers.current.pointer?.(event.clientX, event.clientY);
        }
        props.onPointerMove?.(event);
      }}
      ref={canvasRef}
      style={{
        display: "inline-block",
        verticalAlign: "middle",
        width: size * BOT_AVATAR_OVERSCAN,
        height: size * BOT_AVATAR_OVERSCAN,
        marginLeft: -size * margin,
        marginRight: -size * margin,
        marginTop: -size * (margin + BOT_AVATAR_RISE),
        marginBottom: -size * (margin - BOT_AVATAR_RISE),
        flex: "none",
        ...style,
      }}
    />
  );
});
