import "./App.scss";
import { useEffect } from "react";
import RoomToggleButton from "./components/Buttons/RoomToggleButton/RoomToggleButton";
import ViewModeBar from "./components/ViewModeBar/ViewModeBar";
import AssetList from "./components/AssetList/AssetList";
import Experience from "./Experience/Experience";
import { useResponsiveStore } from "./stores/useResponsiveStore";

function App() {
  const { updateDimensions } = useResponsiveStore();

  useEffect(() => {
    window.addEventListener("resize", updateDimensions);

    return () => {
      window.removeEventListener("resize", updateDimensions);
    };
  }, [updateDimensions]);

  return (
    <>
      <ViewModeBar />
      <AssetList />
      <RoomToggleButton />
      <Experience />
    </>
  );
}

export default App;
