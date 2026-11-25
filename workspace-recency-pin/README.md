# @local/dsh-workspace-recency-pin

Sorts the sidebar's workspaces by recent use, and pins workspaces to the top.

## What it does

- **Recency order.** Workspaces are ordered by the most recent activity of the Sessions inside them — the same `updatedAt` the Session rows show, and the same rule the Session list's **Last updated** mode uses. A workspace with no activity falls back to its own `updatedAt`.
- **Pinned first.** Pinned workspaces form the leading partition, exactly like the pinned Session partition: inside the pinned group and inside the rest, recency decides.
- **Pin action.** Right-click a workspace row, or expand it and open its `...` menu — either opens the same menu, which gains "Pin workspace" / "Unpin workspace", drawn with the pushpin glyph the Session rows use. A short toast confirms the change.

The order is kept in the Host's durable workspace registry order through `workspaceRegistry.insertBefore`, so the built-in sidebar renders it and no shipped Client slot is replaced.

## Limitations

- Workspace order is automatic. Dragging a workspace is a temporary manual change: the next sort — within a minute, or on the next Session message — restores recency order.
- The workspace row has no decoration slot, so a pinned workspace is marked by its position and its menu label; it does not draw a row-level pushpin the way a pinned Session does.
- In the **Workspace tree** grouping a pinned workspace leads only its own siblings inside its parent, because the tree nests each workspace under its nearest registered ancestor.
- Sorting needs this Host process. It persists the pin set and the last known Session times in `~/.dsh/workspace-recency-pin/state.json` (or `$DSH_HOME/workspace-recency-pin/state.json`), so a restart sorts from that snapshot before any browser connects.

## Disable

Turn the bundle off in **Settings → Plugins**. Sessions, workspaces, and files are untouched; the last sorted order stays until a workspace is created, deleted, or dragged.
