import type { CustomMember, ShapeType } from "../../../App";

/**
 * String-serializes a CustomMember[] tree for use as (part of) a cache/
 * request key. Extracted verbatim from CSGGroup.tsx's inline
 * `serializeCustomMembers` — same exact behavior (semicolon-joined, includes
 * color, does NOT recurse into a member's own nested customMembers) — so
 * CustomShapeMesh.tsx can build an equivalent depsKey for its own
 * shape.customMembers tree without a second hand-rolled version that could
 * drift from this one.
 *
 * Note this does not recurse into nested customMembers (a member whose own
 * `type === "custom"` has its own sub-tree) — that is unchanged
 * pre-existing behavior carried over from CSGGroup.tsx's original inline
 * version, not something introduced here.
 */
export function serializeCustomMembers(cms?: CustomMember[]): string {
  if (!cms) return "";
  return cms
    .map(
      (cm) =>
        `${cm.type}-${cm.url || ""}-${cm.offset.join(",")}-${cm.rotation.join(",")}-${cm.scale.join(",")}-${cm.isHole}-${cm.color || ""}`,
    )
    .join(";");
}

/**
 * Every "glb" URL reachable from a CustomMember[] tree, including through
 * nested customMembers at any depth. The shared walker CSGGroup.tsx's own
 * collectGlbUrls (ShapeType[] members) delegates to for each member's
 * nested tree, and what CustomShapeMesh.tsx uses directly for its single
 * shape's own customMembers.
 */
export function collectGlbUrlsFromCustomMembers(
  cms: CustomMember[] | undefined,
  into: Set<string> = new Set(),
): Set<string> {
  cms?.forEach((cm) => {
    if (cm.type === "glb" && cm.url) into.add(cm.url);
    if (cm.type === "custom") collectGlbUrlsFromCustomMembers(cm.customMembers, into);
  });
  return into;
}

/**
 * Every "glb" URL reachable from a group's ShapeType[] members, including
 * through nested customMembers trees on any "custom"-type member.
 */
export function collectGlbUrls(members: ShapeType[]): Set<string> {
  const urls = new Set<string>();
  members.forEach((s) => {
    if (s.type === "glb" && s.url) urls.add(s.url);
    if (s.type === "custom") collectGlbUrlsFromCustomMembers(s.customMembers, urls);
  });
  return urls;
}
