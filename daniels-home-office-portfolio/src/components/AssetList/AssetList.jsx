import { useEffect, useMemo, useRef, useState } from "react";
import "./AssetList.scss";
import { CHUNKS, detailLine, partsByTheme } from "../../Experience/parts/catalog";
import { useViewStore } from "../../stores/viewStore";
import { useToggleRoomStore } from "../../stores/toggleRoomStore";

const AssetList = () => {
  const mode = useViewStore((state) => state.mode);
  const selectedId = useViewStore((state) => state.selectedId);
  const partStats = useViewStore((state) => state.partStats);
  const hidden = useViewStore((state) => state.hidden);
  const layoutMeta = useViewStore((state) => state.layoutMeta);
  const setSelectedId = useViewStore((state) => state.setSelectedId);
  const setHoveredId = useViewStore((state) => state.setHoveredId);
  const toggleHidden = useViewStore((state) => state.toggleHidden);
  const requestFrame = useViewStore((state) => state.requestFrame);
  const isDarkRoom = useToggleRoomStore((state) => state.isDarkRoom);
  const [query, setQuery] = useState("");
  const searchRef = useRef(null);
  const theme = isDarkRoom ? "dark" : "light";
  const items = partsByTheme(theme);
  const anchorName = layoutMeta[theme]?.anchorName || "结构壳体";
  const needle = query.trim().toLowerCase();

  const groups = useMemo(() => {
    return CHUNKS.map((chunk) => {
      const chunkItems = items.filter((part) => part.chunk === chunk.id);
      const visible = chunkItems.filter((part) => {
        if (!needle) return true;
        const stat = partStats[part.id];
        const detail = detailLine(part, stat?.triangles);
        const haystack = [part.label, part.kind, part.file, detail, stat?.meshNames]
          .join(" ")
          .toLowerCase();
        return haystack.includes(needle);
      });
      return { ...chunk, items: chunkItems, visible };
    }).filter((group) => group.visible.length > 0);
  }, [items, needle, partStats]);

  const shown = groups.reduce((sum, group) => sum + group.visible.length, 0);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== "Escape" || document.activeElement === searchRef.current) {
        return;
      }
      setSelectedId(null);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSelectedId]);

  useEffect(() => {
    if (!selectedId || mode === "assembled") return;
    document.getElementById(`asset-${selectedId}`)?.scrollIntoView({
      block: "nearest",
    });
  }, [mode, selectedId]);

  if (mode === "assembled") return null;

  const hint =
    shown === 0
      ? "没有匹配的资产"
      : needle
        ? `${shown} / ${items.length} · 单击选中，双击对准`
        : "单击选中，双击对准";

  return (
    <aside
      className={`asset-list${!isDarkRoom ? " light" : ""}`}
      aria-label="可拆分资产"
    >
      <header>
        <h2>可拆分资产</h2>
        <p>
          {items.length} 个资产。{anchorName}留在原位，其余在爆炸视图里分开。
        </p>
      </header>
      <input
        ref={searchRef}
        className="asset-search"
        type="search"
        value={query}
        placeholder="搜索名称或文件"
        aria-label="搜索资产"
        onChange={(event) => setQuery(event.target.value)}
      />
      <p className="asset-hint">{hint}</p>
      <div className="asset-scroll">
        {groups.map((group) => (
          <section key={group.id}>
            <h3>
              {group.title}
              <span>{needle ? group.visible.length : group.items.length}</span>
            </h3>
            <ul>
              {group.visible.map((part) => {
                const index = group.items.indexOf(part) + 1;
                const stat = partStats[part.id];
                const detail = detailLine(part, stat?.triangles);
                const isHidden = Boolean(hidden[part.id]);
                return (
                  <li
                    key={part.id}
                    id={`asset-${part.id}`}
                    className={isHidden ? "is-hidden" : ""}
                    onMouseEnter={() => setHoveredId(part.id)}
                    onMouseLeave={() => setHoveredId(null)}
                  >
                    <button
                      type="button"
                      className="asset-eye"
                      aria-label={isHidden ? "显示" : "隐藏"}
                      onClick={() => toggleHidden(part.id)}
                    />
                    <button
                      type="button"
                      className={`asset-select${part.id === selectedId ? " is-selected" : ""}`}
                      title={detail}
                      onClick={() => setSelectedId(part.id)}
                      onDoubleClick={() => requestFrame(part.id)}
                    >
                      <span className="asset-index">
                        {String(index).padStart(2, "0")}
                      </span>
                      <span className="asset-copy">
                        <strong>{part.label}</strong>
                        <small>{detail}</small>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  );
};

export default AssetList;
