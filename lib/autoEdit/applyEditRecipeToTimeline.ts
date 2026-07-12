import { nanoid } from "nanoid";
import type { Caption, EditRecipe, TimelineClip, Track } from "@/types";
import {
  placeWithoutOverlap,
  rearrangeMainTrack,
  remapCaptions,
  remapOverlayTracks,
  round3,
} from "@/lib/timeline/tracks";
import { cleanCaptions } from "@/lib/captions/clean";

/**
 * Applies an EditRecipe to the project as REAL timeline data:
 *  - main track sliced/reordered to the recipe's kept ranges
 *  - captions remapped through the cuts, then cleaned + auto-emphasized
 *  - zoom clips added to the effects track
 *  - hook/CTA text clips added to the text track
 * Pure function — the store commits the result as one undo step.
 */

export interface ApplyRecipeResult {
  tracks: Track[];
  captions: Caption[];
}

export function applyEditRecipeToTimeline(
  tracks: Track[],
  captions: Caption[],
  recipe: EditRecipe
): ApplyRecipeResult | null {
  const vi = tracks.findIndex((t) => t.type === "video");
  if (vi < 0) return null;

  /* 1. Rearrange the main track + remap everything else through the cuts.
        rangeSpeeds carries the recipe's speed ramps onto the sliced clips. */
  const newMain = rearrangeMainTrack(tracks[vi], recipe.keptRanges, recipe.rangeSpeeds);
  if (newMain.clips.length === 0) return null;

  const nextTracks = remapOverlayTracks(tracks, recipe.keptRanges);
  nextTracks[vi] = newMain;

  let nextCaptions = remapCaptions(captions, recipe.keptRanges);

  /* 2. Caption cleanup + emphasis (recipe carries per-caption intents; the
        clean pass realizes them on whatever survived the cuts). */
  nextCaptions = cleanCaptions(nextCaptions);

  /* 3. Zooms + flashes → effects track. Flashes keep their exact timing (they
        must land ON the cut) and may overlap a zoom — both render together. */
  const ei = nextTracks.findIndex((t) => t.type === "effects");
  if (ei >= 0 && (recipe.zooms.length > 0 || (recipe.flashes?.length ?? 0) > 0)) {
    const effects = nextTracks[ei];
    let clips = [...effects.clips];
    for (const zoom of recipe.zooms) {
      const clip: TimelineClip = {
        id: nanoid(8),
        type: "effects",
        startTime: round3(zoom.start),
        endTime: round3(zoom.end),
        effect: {
          kind: "zoom",
          zoomScale: zoom.scale,
          anchorX: zoom.anchorX ?? 0.5,
          anchorY: zoom.anchorY ?? 0.45,
        },
        metadata: { reason: zoom.reason, recipeId: recipe.id },
      };
      const placed = placeWithoutOverlap({ ...effects, clips }, clip);
      if (placed.endTime - placed.startTime > 0.3) clips = [...clips, placed];
    }
    for (const flash of recipe.flashes ?? []) {
      if (flash.end - flash.start < 0.08) continue;
      clips = [
        ...clips,
        {
          id: nanoid(8),
          type: "effects",
          startTime: round3(flash.start),
          endTime: round3(flash.end),
          effect: { kind: "flash" },
          metadata: { recipeId: recipe.id },
        },
      ];
    }
    nextTracks[ei] = { ...effects, clips };
  }

  /* 4. Hook/CTA text overlays → text track. */
  const ti = nextTracks.findIndex((t) => t.type === "text");
  if (ti >= 0 && recipe.overlays.length > 0) {
    const text = nextTracks[ti];
    let clips = [...text.clips];
    for (const overlay of recipe.overlays) {
      const clip: TimelineClip = {
        id: nanoid(8),
        type: overlay.kind === "sticker" ? "sticker" : "text",
        text: overlay.text,
        startTime: round3(overlay.start),
        endTime: round3(overlay.end),
        transform: { x: 0, y: overlay.y ?? -520, scale: 1, rotation: 0, opacity: 1 },
        style: {
          fontFamily: "Arial",
          fontSize: overlay.role === "hook" ? 68 : 56,
          fontWeight: 900,
          color: "#FFFFFF",
          strokeColor: "#000000",
          strokeWidth: 6,
          backgroundColor: overlay.role === "cta" ? "#7C3AED" : null,
        },
        metadata: { role: overlay.role, recipeId: recipe.id },
      };
      const placed = placeWithoutOverlap({ ...text, clips }, clip);
      if (placed.endTime - placed.startTime > 0.3) clips = [...clips, placed];
    }
    nextTracks[ti] = { ...text, clips };
  }

  return { tracks: nextTracks, captions: nextCaptions };
}
