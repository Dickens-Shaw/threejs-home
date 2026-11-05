import "./ViewModeBar.scss";
import { useViewStore } from "../../stores/viewStore";
import { useToggleRoomStore } from "../../stores/toggleRoomStore";

const MODES = [
  { id: "assembled", label: "组装" },
  { id: "exploded", label: "爆炸" },
  { id: "list", label: "列表" },
];

const ViewModeBar = () => {
  const mode = useViewStore((state) => state.mode);
  const setMode = useViewStore((state) => state.setMode);
  const isDarkRoom = useToggleRoomStore((state) => state.isDarkRoom);
  const isTransitioning = useToggleRoomStore((state) => state.isTransitioning);
  const className = `view-mode${!isDarkRoom ? " light" : ""}`;

  return (
    <div className={className} role="tablist" aria-label="查看方式">
      {MODES.map((item) => {
        const active = mode === item.id;
        return (
          <button
            key={item.id}
            type="button"
            className={active ? "is-active" : ""}
            aria-pressed={active}
            onClick={() => {
              if (isTransitioning || active) return;
              setMode(item.id);
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
};

export default ViewModeBar;
