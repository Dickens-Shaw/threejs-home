import { useRef, useEffect } from "react";
import gsap from "gsap";
import Scene from "./Scene";
import { Canvas } from "@react-three/fiber";

import { OrthographicCamera } from "@react-three/drei";
import { useToggleRoomStore } from "../stores/toggleRoomStore";
import { useResponsiveStore } from "../stores/useResponsiveStore";
import { useViewStore } from "../stores/viewStore";
import { CAMERA_ROTATION, cameraPositions, zoomFor } from "./camera";

const applyTheme = (isDarkRoom) => {
  const theme = isDarkRoom ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  document.body.dataset.theme = theme;
};

const Experience = () => {
  const cameraRef = useRef();
  const pointerRef = useRef({ x: 0, y: 0 });
  const skipInitialToggle = useRef(true);
  const isMobileRef = useRef(false);
  const mode = useViewStore((state) => state.mode);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const { isMobile } = useResponsiveStore();
  isMobileRef.current = isMobile;

  const { isDarkRoom, setIsBeforeZooming, setIsTransitioning } =
    useToggleRoomStore();

  useEffect(() => {
    if (!cameraRef.current || modeRef.current !== "assembled") return;

    const zoom = zoomFor(isMobile);
    cameraRef.current.zoom = zoom.default;
    cameraRef.current.updateProjectionMatrix();
  }, [isMobile]);

  useEffect(() => {
    if (!cameraRef.current) return;

    if (modeRef.current !== "assembled") {
      applyTheme(isDarkRoom);
      return;
    }

    const targetPosition = isDarkRoom
      ? cameraPositions.dark.position
      : cameraPositions.light.position;

    if (skipInitialToggle.current) {
      skipInitialToggle.current = false;
      applyTheme(isDarkRoom);
      gsap.set(cameraRef.current.position, {
        x: targetPosition[0],
        y: targetPosition[1],
        z: targetPosition[2],
      });
      return;
    }

    const zoom = zoomFor(isMobileRef.current);
    const timeline = gsap.timeline({
      onComplete: () => {
        setIsTransitioning(false);
      },
    });

    timeline
      .to(cameraRef.current, {
        zoom: zoom.animation,
        duration: 1,
        ease: "power3.out",
        onStart: () => {
          setIsTransitioning(true);
          setIsBeforeZooming(true);
        },
        onUpdate: () => {
          cameraRef.current.updateProjectionMatrix();
        },
      })
      .to(cameraRef.current.position, {
        x: targetPosition[0],
        y: targetPosition[1],
        z: targetPosition[2],
        duration: 1.5,
        ease: "power3.out",
        onStart: () => {
          applyTheme(isDarkRoom);
        },
      })
      .to(cameraRef.current, {
        zoom: zoom.default,
        duration: 1,
        ease: "power3.out",
        onStart: () => {
          setIsBeforeZooming(false);
        },
        onUpdate: () => {
          cameraRef.current.updateProjectionMatrix();
        },
      });

    return () => {
      timeline.kill();
    };
  }, [isDarkRoom, setIsBeforeZooming, setIsTransitioning]);

  useEffect(() => {
    const onPointerMove = (e) => {
      pointerRef.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointerRef.current.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };

    const onTouchMove = (e) => {
      if (e.touches.length === 1) {
        pointerRef.current.x =
          (e.touches[0].clientX / window.innerWidth) * 2 - 1;
        pointerRef.current.y =
          -(e.touches[0].clientY / window.innerHeight) * 2 + 1;
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("touchmove", onTouchMove, { passive: true });

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  return (
    <Canvas
      style={{
        position: "fixed",
        zIndex: 1,
        top: 0,
        left: 0,
        background: "transparent",
      }}
      gl={{ alpha: true, antialias: true }}
    >
      <OrthographicCamera
        ref={cameraRef}
        makeDefault
        position={cameraPositions.dark.position}
        rotation={CAMERA_ROTATION}
        zoom={zoomFor(isMobile).default}
      />
      <Scene pointerRef={pointerRef} />
    </Canvas>
  );
};

export default Experience;
